/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { GitpodExtensionContext, registerTasks, setupGitpodContext, registerIpcHookCli } from 'gitpod-shared';
import * as path from 'path';
import * as vscode from 'vscode';
import { configureMachineSettings } from './machineSettings';
import { tunnelPorts } from './ports';
import { GitpodPortViewProvider } from './portViewProvider';
import { initializeRemoteExtensions, installInitialExtensions, ISyncExtension } from './remoteExtensionInit';

let gitpodContext: GitpodExtensionContext | undefined;
export async function activate(context: vscode.ExtensionContext) {
	gitpodContext = await setupGitpodContext(context);
	if (!gitpodContext) {
		return;
	}

	registerCommands(gitpodContext);
	registerTasks(gitpodContext);
	installInitialExtensions(gitpodContext);

	const portViewProvider = new GitpodPortViewProvider(gitpodContext);
	context.subscriptions.push(vscode.window.registerWebviewViewProvider(GitpodPortViewProvider.viewType, portViewProvider, { webviewOptions: { retainContextWhenHidden: true } }));

	let initial = true;
	context.subscriptions.push(gitpodContext.supervisor.onDidChangePortStatus(portList => {
		const promise = configureMachineSettings(gitpodContext!, portList);
		if (initial) {
			initial = false;
			promise.then(() => tunnelPorts(portList));
		} else {
			// Manually tunnel for now until fixing vscode bug where `remote.autoForwardPortsSource` is not respected on first connection
			tunnelPorts(portList)
		}
		portViewProvider.updatePortsStatus(portList);
	}));
	gitpodContext.supervisor.startObservePortsStatus();

	registerCLI(gitpodContext);
	// configure task terminals if Gitpod Code Server is running
	if (process.env.GITPOD_THEIA_PORT) {
		registerIpcHookCli(gitpodContext);
	}

	// For port tunneling we rely on Remote SSH capabilities
	// and gitpod.gitpod to disable auto tunneling from the current local machine.
	vscode.commands.executeCommand('gitpod.api.autoTunnel', gitpodContext.info.gitpodHost, gitpodContext.info.instanceId, false);

	// TODO
	// - auth?
	// - .gitpod.yml validations
	// - add to .gitpod.yml command
	// - cli integration
	//   - git credential helper
	await gitpodContext.active;
}

export async function deactivate() {
	await gitpodContext?.dispose();
}

/**
 * configure CLI in regular terminals
 */
function registerCLI(context: GitpodExtensionContext): void {
	context.environmentVariableCollection.replace('EDITOR', 'code');
	context.environmentVariableCollection.replace('VISUAL', 'code');
	context.environmentVariableCollection.replace('GP_OPEN_EDITOR', 'code');
	context.environmentVariableCollection.replace('GIT_EDITOR', 'code --wait');
	context.environmentVariableCollection.replace('GP_PREVIEW_BROWSER', `${process.execPath} ${path.join(__dirname, 'cli.js')} --preview`);
	context.environmentVariableCollection.replace('GP_EXTERNAL_BROWSER', 'code --openExternal');

	const ipcHookCli = context.ipcHookCli;
	if (!ipcHookCli) {
		return;
	}
	context.environmentVariableCollection.replace('GITPOD_REMOTE_CLI_IPC', ipcHookCli);
}

function registerCommands(context: GitpodExtensionContext) {
	// For collecting logs, will be called by gitpod-desktop extension;
	context.subscriptions.push(vscode.commands.registerCommand('__gitpod.getGitpodRemoteLogsUri', () => {
		return context.logUri;
	}));

	// Initialize remote extensions
	context.subscriptions.push(vscode.commands.registerCommand('__gitpod.initializeRemoteExtensions', (extensions: ISyncExtension[]) => initializeRemoteExtensions(extensions, gitpodContext!)));
}

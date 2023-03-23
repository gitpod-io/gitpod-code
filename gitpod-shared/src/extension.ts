/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { registerActiveLanguageAnalytics } from './analytics';
import { createGitpodExtensionContext, registerDefaultLayout, registerNotifications, registerWorkspaceCommands, registerWorkspaceSharing, registerWorkspaceTimeout } from './features';
import { ValidateService } from './validate';
import { GitpodExtensionContext } from './gitpodContext';

export { GitpodExtensionContext } from './gitpodContext';
export { registerTasks, registerIpcHookCli } from './features';

export * from './common/utils';
export * from './common/dispose';
export { ILogService } from './logService';
export { TelemetryService } from './telemetryService';
export * from './gitpod-plugin-model';
export * from './workspacePort';

export async function setupGitpodContext(context: vscode.ExtensionContext): Promise<GitpodExtensionContext | undefined> {
	const gitpodContext = await createGitpodExtensionContext(context);
	vscode.commands.executeCommand('setContext', 'gitpod.inWorkspace', !!gitpodContext);
	if (!gitpodContext) {
		return undefined;
	}

	logContextInfo(gitpodContext);

	vscode.commands.executeCommand('setContext', 'gitpod.ideAlias', gitpodContext.info.ideAlias);
	vscode.commands.executeCommand('setContext', 'gitpod.UIKind', vscode.env.uiKind === vscode.UIKind.Web ? 'web' : 'desktop');

	gitpodContext.telemetryService.sendTelemetryEvent('vscode_session', {
		...gitpodContext.getWorkspaceTelemetryProperties(),
	});


	registerActiveLanguageAnalytics(gitpodContext);
	registerWorkspaceCommands(gitpodContext);
	registerWorkspaceSharing(gitpodContext);
	registerWorkspaceTimeout(gitpodContext);
	registerNotifications(gitpodContext);
	registerDefaultLayout(gitpodContext);
	gitpodContext.subscriptions.push(new ValidateService(gitpodContext));

	return gitpodContext;
}

function logContextInfo(context: GitpodExtensionContext) {
	context.logger.info(`VSCODE_MACHINE_ID: ${vscode.env.machineId}`);
	context.logger.info(`VSCODE_SESSION_ID: ${vscode.env.sessionId}`);
	context.logger.info(`VSCODE_VERSION: ${vscode.version}`);
	context.logger.info(`VSCODE_APP_NAME: ${vscode.env.appName}`);
	context.logger.info(`VSCODE_APP_HOST: ${vscode.env.appHost}`);
	context.logger.info(`VSCODE_UI_KIND: ${vscode.env.uiKind === vscode.UIKind.Web ? 'web' : 'desktop'}`);

	context.logger.info(`GITPOD_WORKSPACE_CONTEXT_URL: ${context.info.workspaceContextUrl}`);
	context.logger.info(`GITPOD_INSTANCE_ID: ${context.info.instanceId}`);
	context.logger.info(`GITPOD_WORKSPACE_URL: ${context.info.workspaceUrl}`);
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { GitpodExtensionContext, setupGitpodContext, registerTasks, registerIpcHookCli, ExposedServedGitpodWorkspacePort, GitpodWorkspacePort, isExposedServedGitpodWorkspacePort } from 'gitpod-shared';
import { PortsStatus, PortVisibility } from '@gitpod/supervisor-api-grpc/lib/status_pb';
import * as vscode from 'vscode';
import { registerWelcomeWalkthroughContribution, WELCOME_WALKTROUGH_KEY } from './welcomeWalktrough';
import { GitpodPortViewProvider } from './portViewProvider';
import { registerExtensionManagement } from './extensionManagement';
import { GithubAuthenticationProvider, GitpodAuthenticationProvider } from './authentication';

let gitpodContext: GitpodExtensionContext | undefined;
export async function activate(context: vscode.ExtensionContext) {
	gitpodContext = await setupGitpodContext(context);
	if (!gitpodContext) {
		return;
	}

	gitpodContext.logger.info(`Gitpod Web ${context.extension.packageJSON.commit || context.extension.packageJSON.version}`);

	context.globalState.setKeysForSync([WELCOME_WALKTROUGH_KEY]);

	gitpodContext.subscriptions.push(new GitpodAuthenticationProvider(gitpodContext));
	gitpodContext.subscriptions.push(new GithubAuthenticationProvider(gitpodContext));


	registerCommands(gitpodContext);
	registerDesktop();
	registerPorts(gitpodContext);
	registerTasks(gitpodContext).then(() => {
		setTimeout(() => {
			if (vscode.window.terminals.length === 0) {
				// Always show terminal if no task terminals are created
				vscode.commands.executeCommand('terminal.focus', { preserveFocus: true });
			}
		}, 0);
	});

	registerIpcHookCli(gitpodContext);
	registerExtensionManagement(gitpodContext);
	registerWelcomeWalkthroughContribution(gitpodContext);

	gitpodContext.experiments.get('dataops', false)
		.then(dataops => vscode.commands.executeCommand('setContext', 'gitpod.dataops', !!dataops));

	await gitpodContext.active;
}

export async function deactivate() {
	await gitpodContext?.dispose();
}

async function registerPorts(context: GitpodExtensionContext): Promise<void> {
	const portMap = new Map<number, GitpodWorkspacePort>();
	const tunnelMap = new Map<number, vscode.TunnelDescription>();

	// register webview
	const portViewProvider = new GitpodPortViewProvider(context);
	context.subscriptions.push(vscode.window.registerWebviewViewProvider(GitpodPortViewProvider.viewType, portViewProvider, { webviewOptions: { retainContextWhenHidden: true } }));

	function openExternal(port: GitpodWorkspacePort) {
		return vscode.env.openExternal(vscode.Uri.parse(port.localUrl));
	}

	context.subscriptions.push(context.supervisor.onDidChangePortStatus((portList) => {
		portMap.clear();
		for (const portStatus of portList) {
			portMap.set(portStatus.localPort, new GitpodWorkspacePort(portStatus.localPort, portStatus, tunnelMap.get(portStatus.localPort)));
		}
		portViewProvider.updatePortsStatus(portList);
	}));
	context.supervisor.startObservePortsStatus();

	context.subscriptions.push(vscode.commands.registerCommand('gitpod.resolveExternalPort', (portNumber: number) => {
		// eslint-disable-next-line no-async-promise-executor
		return new Promise<string>(async (resolve, reject) => {
			try {
				const tryResolve = () => {
					const port = portMap.get(portNumber);
					const exposed = port?.status?.exposed;
					if (exposed) {
						resolve(exposed.url);
						return true;
					}
					return false;
				};
				if (!tryResolve()) {
					const listenerWebview = portViewProvider.onDidChangePorts(element => {
						if (element === portViewProvider.portMap && tryResolve()) {
							listenerWebview?.dispose();
						}
					});
					await context.supervisor.exposePort(portNumber);
				}
			} catch (e) {
				reject(e);
			}
		});
	}));

	const portsStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
	context.subscriptions.push(portsStatusBarItem);
	async function updateStatusBar(): Promise<void> {
		const publicExposedPorts: number[] = [];
		const privateExposedPorts: number[] = [];

		for (const port of portMap.values()) {
			if (isExposedServedGitpodWorkspacePort(port)) {
				if (port.status.exposed.visibility === PortVisibility.PUBLIC) {
					publicExposedPorts.push(port.status.localPort);
				} else {
					privateExposedPorts.push(port.status.localPort);
				}
			}
		}

		let text: string;
		let tooltip = 'Click to open "Ports View"';
		if (publicExposedPorts.length + privateExposedPorts.length) {
			text = 'Ports:';
			tooltip += '\n\nPorts';
			text += ` ${[...publicExposedPorts, ...privateExposedPorts].join(', ')}`;
			tooltip += publicExposedPorts.length ? `\nPublic: ${publicExposedPorts.join(', ')}` : '';
			tooltip += privateExposedPorts.length ? `\nPrivate: ${privateExposedPorts.join(', ')}` : '';
		} else {
			text = '$(circle-slash) No open ports';
		}

		portsStatusBarItem.text = text;
		portsStatusBarItem.tooltip = tooltip;

		portsStatusBarItem.command = 'gitpod.portsView.focus';
		portsStatusBarItem.show();
	}
	updateStatusBar();

	context.subscriptions.push(portViewProvider.onDidChangePorts(() => updateStatusBar()));

	const currentNotifications = new Set<number>();
	async function showOpenServiceNotification(port: GitpodWorkspacePort, offerMakePublic = false): Promise<void> {
		const localPort = port.portNumber;
		if (currentNotifications.has(localPort)) {
			return;
		}

		const makePublic = 'Make Public';
		const openAction = 'Open Preview';
		const openExternalAction = 'Open Browser';
		const actions = offerMakePublic ? [makePublic, openAction, openExternalAction] : [openAction, openExternalAction];

		currentNotifications.add(localPort);
		const result = await vscode.window.showInformationMessage('A service is available on port ' + localPort, ...actions);
		currentNotifications.delete(localPort);

		if (result === makePublic) {
			await gitpodContext?.controlPort(port.status.localPort, port.status.exposed, { visibility: PortVisibility.PUBLIC });
		} else if (result === openAction) {
			await openPreview(port);
		} else if (result === openExternalAction) {
			await openExternal(port);
		}
	}
	async function openPreview(port: GitpodWorkspacePort): Promise<void> {
		await vscode.commands.executeCommand('simpleBrowser.api.open', port.externalUrl.toString(), {
			viewColumn: vscode.ViewColumn.Beside,
			preserveFocus: true
		});
	}
	const onDidExposeServedPortListener = (port: ExposedServedGitpodWorkspacePort) => {
		if (port.status.onOpen === PortsStatus.OnOpenAction.IGNORE) {
			return;
		}

		if (port.status.onOpen === PortsStatus.OnOpenAction.OPEN_BROWSER) {
			openExternal(port);
			return;
		}

		if (port.status.onOpen === PortsStatus.OnOpenAction.OPEN_PREVIEW) {
			openPreview(port);
			return;
		}

		if (port.status.onOpen === PortsStatus.OnOpenAction.NOTIFY) {
			showOpenServiceNotification(port);
			return;
		}

		if (port.status.onOpen === PortsStatus.OnOpenAction.NOTIFY_PRIVATE) {
			showOpenServiceNotification(port, port.status.exposed.visibility !== PortVisibility.PUBLIC);
			return;
		}
	};
	context.subscriptions.push(portViewProvider.onDidExposeServedPort(onDidExposeServedPortListener));

	let updateTunnelsTokenSource: vscode.CancellationTokenSource | undefined;
	async function updateTunnels(): Promise<void> {
		if (updateTunnelsTokenSource) {
			updateTunnelsTokenSource.cancel();
		}
		updateTunnelsTokenSource = new vscode.CancellationTokenSource();
		const token = updateTunnelsTokenSource.token;
		// not vscode.workspace.tunnels because of https://github.com/microsoft/vscode/issues/124334
		const currentTunnels = (await vscode.commands.executeCommand('gitpod.getTunnels')) as vscode.TunnelDescription[];
		if (token.isCancellationRequested) {
			return;
		}
		tunnelMap.clear();
		currentTunnels.forEach(tunnel => {
			tunnelMap.set(tunnel.remoteAddress.port, tunnel);
		});
		portViewProvider.updateTunnels(tunnelMap);
	}
	updateTunnels();
	context.subscriptions.push(vscode.workspace.onDidChangeTunnels(() => updateTunnels()));
	context.subscriptions.push(vscode.commands.registerCommand('gitpod.vscode.workspace.openTunnel', (tunnelOptions: vscode.TunnelOptions) => {
		return vscode.workspace.openTunnel(tunnelOptions);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('gitpod.api.openTunnel', (tunnelOptions: vscode.TunnelOptions, _tunnelCreationOptions: vscode.TunnelCreationOptions) => {
		context.supervisor.openTunnel(
			tunnelOptions.remoteAddress.port,
			tunnelOptions.localAddressPort || tunnelOptions.remoteAddress.port,
			tunnelOptions.privacy
		);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('gitpod.api.closeTunnel', (port: number) => {
		context.supervisor.closeTunnel(port);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('gitpod.dev.enableForwardedPortsView', () =>
		vscode.commands.executeCommand('setContext', 'forwardedPortsViewEnabled', true)
	));
	context.subscriptions.push(vscode.commands.registerCommand('gitpod.dev.connectLocalApp', async () => {
		const apiPortInput = await vscode.window.showInputBox({
			title: 'Connect to Local App',
			prompt: 'Enter Local App API port',
			value: '63100',
			validateInput: value => {
				const port = Number(value);
				if (port <= 0) {
					return 'port should be greater than 0';
				}
				if (port >= 65535) {
					return 'port should be less than 65535';
				}
				return undefined;
			}
		});
		if (apiPortInput) {
			const apiPort = Number(apiPortInput);
			vscode.commands.executeCommand('gitpod.api.connectLocalApp', apiPort);
		}
	}));
	vscode.commands.executeCommand('setContext', 'gitpod.portsView.visible', true);
}

function registerCommands(context: GitpodExtensionContext) {
	function openDesktop(scheme: 'vscode' | 'vscode-insiders'): void {
		const uri = vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.[0]?.uri;
		vscode.commands.executeCommand('gitpod.api.openDesktop', vscode.Uri.from({
			scheme,
			authority: 'gitpod.gitpod-desktop',
			path: uri?.path || context.info.workspaceLocationFile || context.info.workspaceLocationFolder || context.info.checkoutLocation,
			query: JSON.stringify({
				instanceId: context.info.instanceId,
				workspaceId: context.info.workspaceId,
				gitpodHost: context.info.gitpodHost,
				debugWorkspace: context.isDebugWorkspace()
			})
		}).toString());
	}
	context.subscriptions.push(vscode.commands.registerCommand('gitpod.openInStable', () => {
		context.telemetryService.sendTelemetryEvent('vscode_execute_command_gitpod_change_vscode_type', {
			...context.getWorkspaceTelemetryProperties(),
			targetUiKind: 'desktop',
			targetQualifier: 'stable'
		});

		return openDesktop('vscode');
	}));
	context.subscriptions.push(vscode.commands.registerCommand('gitpod.openInInsiders', () => {
		context.telemetryService.sendTelemetryEvent('vscode_execute_command_gitpod_change_vscode_type', {
			...context.getWorkspaceTelemetryProperties(),
			targetUiKind: 'desktop',
			targetQualifier: 'insiders'
		});
		return openDesktop('vscode-insiders');
	}));
	context.subscriptions.push(vscode.commands.registerCommand('gitpod.open.context', () => {
		const url = context.workspaceContextUrl.toString();
		context.telemetryService.sendTelemetryEvent('vscode_execute_command_gitpod_open_link', {
			...context.getWorkspaceTelemetryProperties(),
			url
		});
		return vscode.env.openExternal(vscode.Uri.parse(url));
	}));

	if (context.workspaceOwned) {
		context.subscriptions.push(vscode.commands.registerCommand('gitpod.stop.ws', () => {
			context.telemetryService.sendTelemetryEvent('vscode_execute_command_gitpod_workspace', {
				...context.getWorkspaceTelemetryProperties(),
				action: 'stop'
			});
			return context.gitpod.server.stopWorkspace(context.info.workspaceId);
		}));
	}
}

async function registerDesktop(): Promise<void> {
	const config = vscode.workspace.getConfiguration('gitpod.openInStable');
	if (config.get<boolean>('neverPrompt') === true) {
		return;
	}
	const openAction = 'Open';
	const neverAgain = 'Don\'t Show Again';
	const action = await vscode.window.showInformationMessage('Do you want to open this workspace in VS Code Desktop?', openAction, neverAgain);
	if (action === openAction) {
		vscode.commands.executeCommand('gitpod.openInStable');
	} else if (action === neverAgain) {
		config.update('neverPrompt', true, true);
	}
}

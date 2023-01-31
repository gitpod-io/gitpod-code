/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { GitpodExtensionContext, GitpodWorkspacePort } from 'gitpod-shared';
import { PortsStatus } from '@gitpod/supervisor-api-grpc/lib/status_pb';
import { TunnelVisiblity } from '@gitpod/supervisor-api-grpc/lib/port_pb';

export async function tunnelPorts(supervisorPortList: PortsStatus.AsObject[]) {
	for (const port of supervisorPortList) {
		if (port.served) {
			await vscode.env.asExternalUri(vscode.Uri.parse(`http://localhost:${port.localPort}`));
		}
	}
}

interface PortItem { port: GitpodWorkspacePort }

export function registerPortCommands(context: GitpodExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand('gitpod.ports.makePrivate', ({ port }: PortItem) => {
		context.fireAnalyticsEvent({
			eventName: 'vscode_execute_command_gitpod_ports',
			properties: { action: 'private' }
		});
		context?.setPortVisibility(port.status.localPort, 'private');
	}));
	context.subscriptions.push(vscode.commands.registerCommand('gitpod.ports.makePublic', ({ port }: PortItem) => {
		context.fireAnalyticsEvent({
			eventName: 'vscode_execute_command_gitpod_ports',
			properties: { action: 'public' }
		});
		context?.setPortVisibility(port.status.localPort, 'public');
	}));
	context.subscriptions.push(vscode.commands.registerCommand('gitpod.ports.tunnelNetwork', ({ port }: PortItem) => {
		context?.supervisor.setTunnelVisibility(port.portNumber, port.portNumber, TunnelVisiblity.NETWORK);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('gitpod.ports.tunnelHost', async ({ port }: PortItem) =>
		context?.supervisor.setTunnelVisibility(port.portNumber, port.portNumber, TunnelVisiblity.HOST)
	));
	context.subscriptions.push(vscode.commands.registerCommand('gitpod.ports.preview', ({ port }: PortItem) => {
		context.fireAnalyticsEvent({
			eventName: 'vscode_execute_command_gitpod_ports',
			properties: { action: 'preview' }
		});
		vscode.commands.executeCommand('simpleBrowser.api.open', port.externalUrl.toString(), {
			viewColumn: vscode.ViewColumn.Beside,
			preserveFocus: true
		});
	}));
	context.subscriptions.push(vscode.commands.registerCommand('gitpod.ports.openBrowser', ({ port }: PortItem) => {
		context.fireAnalyticsEvent({
			eventName: 'vscode_execute_command_gitpod_ports',
			properties: { action: 'openBrowser' }
		});
		vscode.env.openExternal(vscode.Uri.parse(port.localUrl));
	}));
	context.subscriptions.push(vscode.commands.registerCommand('gitpod.ports.retryAutoExpose', ({ port }: PortItem) => {
		context.supervisor.retryAutoExposePort(port.portNumber);
	}));
}

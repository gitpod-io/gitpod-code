/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { PortsStatus } from '@gitpod/supervisor-api-grpc/lib/status_pb';

export async function tunnelPorts(supervisorPortList: PortsStatus.AsObject[]) {
	for (const port of supervisorPortList) {
		if (port.served) {
			await vscode.env.asExternalUri(vscode.Uri.parse(`http://localhost:${port.localPort}`));
		}
	}
}

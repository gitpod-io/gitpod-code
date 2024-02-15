/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { GitpodClient, GitpodServer, GitpodServiceImpl, WorkspaceInstanceUpdateListener } from '@gitpod/gitpod-protocol/lib/gitpod-service';
import { User } from '@gitpod/gitpod-protocol/lib/protocol';
import { ControlServiceClient } from '@gitpod/supervisor-api-grpc/lib/control_grpc_pb';
import { ExposePortRequest } from '@gitpod/supervisor-api-grpc/lib/control_pb';
import { InfoServiceClient } from '@gitpod/supervisor-api-grpc/lib/info_grpc_pb';
import { DebugWorkspaceType, WorkspaceInfoRequest, WorkspaceInfoResponse } from '@gitpod/supervisor-api-grpc/lib/info_pb';
import { NotificationServiceClient } from '@gitpod/supervisor-api-grpc/lib/notification_grpc_pb';
import { PortServiceClient } from '@gitpod/supervisor-api-grpc/lib/port_grpc_pb';
import { CloseTunnelRequest, RetryAutoExposeRequest, TunnelPortRequest, TunnelVisiblity } from '@gitpod/supervisor-api-grpc/lib/port_pb';
import { StatusServiceClient } from '@gitpod/supervisor-api-grpc/lib/status_grpc_pb';
import { ExposedPortInfo, PortProtocol, PortVisibility, PortsStatus, PortsStatusRequest, PortsStatusResponse } from '@gitpod/supervisor-api-grpc/lib/status_pb';
import { TerminalServiceClient } from '@gitpod/supervisor-api-grpc/lib/terminal_grpc_pb';
import { TokenServiceClient } from '@gitpod/supervisor-api-grpc/lib/token_grpc_pb';
import { GetTokenRequest } from '@gitpod/supervisor-api-grpc/lib/token_pb';
import * as grpc from '@grpc/grpc-js';
import * as path from 'path';
import ReconnectingWebSocket from 'reconnecting-websocket';
import * as util from 'util';
import * as uuid from 'uuid';
import * as vscode from 'vscode';
import { isGRPCErrorStatus } from './common/utils';
import { ExperimentalSettings } from './experiments';
import { GitpodYml } from './gitpodYaml';
import { ILogService } from './logService';
import { TelemetryService } from './telemetryService';

// Important:
// This class should performs all supervisor API calls used outside this module.
// This is a requirement because mixing Request Objects created in gitpod-web or gitpod-remote with
// the corresponding service client will cause a runtime error as type checking is done with the
// `instanceof` operator and they are different modules loaded from different locations
// E.g.: `Request message serialization failure: Expected argument of type supervisor.PortsStatusRequest`
// https://penx.medium.com/managing-dependencies-in-a-node-package-so-that-they-are-compatible-with-npm-link-61befa5aaca7
export class SupervisorConnection {
	static readonly deadlines = {
		long: 30 * 1000,
		normal: 15 * 1000,
		short: 5 * 1000
	};
	private readonly addr = process.env.SUPERVISOR_ADDR || 'localhost:22999';
	private readonly clientOptions: Partial<grpc.ClientOptions>;
	readonly metadata = new grpc.Metadata();
	readonly status: StatusServiceClient;
	private readonly control: ControlServiceClient;
	readonly notification: NotificationServiceClient;
	private readonly token: TokenServiceClient;
	private readonly info: InfoServiceClient;
	private readonly port: PortServiceClient;
	readonly terminal: TerminalServiceClient;

	private _onDidChangePortStatus = new vscode.EventEmitter<PortsStatus.AsObject[]>();
	public onDidChangePortStatus = this._onDidChangePortStatus.event;

	constructor(
		private context: vscode.ExtensionContext,
		private logger: ILogService
	) {
		this.clientOptions = {
			'grpc.primary_user_agent': `${vscode.env.appName}/${vscode.version} ${context.extension.id}/${context.extension.packageJSON.version}`,
		};
		this.status = new StatusServiceClient(this.addr, grpc.credentials.createInsecure(), this.clientOptions);
		this.control = new ControlServiceClient(this.addr, grpc.credentials.createInsecure(), this.clientOptions);
		this.notification = new NotificationServiceClient(this.addr, grpc.credentials.createInsecure(), this.clientOptions);
		this.token = new TokenServiceClient(this.addr, grpc.credentials.createInsecure(), this.clientOptions);
		this.info = new InfoServiceClient(this.addr, grpc.credentials.createInsecure(), this.clientOptions);
		this.port = new PortServiceClient(this.addr, grpc.credentials.createInsecure(), this.clientOptions);
		this.terminal = new TerminalServiceClient(this.addr, grpc.credentials.createInsecure(), this.clientOptions);

		this.context.subscriptions.push(this._onDidChangePortStatus);
	}

	async getToken(kind: string, host: string, scopes: string[]) {
		const getTokenRequest = new GetTokenRequest();
		getTokenRequest.setKind(kind);
		getTokenRequest.setHost(host);
		for (const scope of scopes) {
			getTokenRequest.addScope(scope);
		}
		const getTokenResponse = await util.promisify(this.token.getToken.bind(this.token, getTokenRequest, this.metadata, {
			deadline: Date.now() + SupervisorConnection.deadlines.long
		}))();
		return getTokenResponse.toObject();
	}

	async exposePort(port: number) {
		const request = new ExposePortRequest();
		request.setPort(port);
		await util.promisify(this.control.exposePort.bind(this.control, request, this.metadata, {
			deadline: Date.now() + SupervisorConnection.deadlines.normal
		}))();
	}

	async retryAutoExposePort(port: number) {
		const request = new RetryAutoExposeRequest();
		request.setPort(port);
		await util.promisify(this.port.retryAutoExpose.bind(this.port, request, this.metadata, {
			deadline: Date.now() + SupervisorConnection.deadlines.normal
		}))();
	}

	private _startObservePortsStatus = false;
	startObservePortsStatus() {
		if (this._startObservePortsStatus) {
			return;
		}
		this._startObservePortsStatus = true;

		let run = true;
		let stopUpdates: Function | undefined;
		(async () => {
			while (run) {
				try {
					const req = new PortsStatusRequest();
					req.setObserve(true);
					const evts = this.status.portsStatus(req, this.metadata);
					stopUpdates = evts.cancel.bind(evts);

					await new Promise((resolve, reject) => {
						evts.on('end', resolve);
						evts.on('error', reject);
						evts.on('data', (update: PortsStatusResponse) => {
							this._onDidChangePortStatus.fire(update.getPortsList().map(p => p.toObject()));
						});
					});
				} catch (err) {
					if (!isGRPCErrorStatus(err, grpc.status.CANCELLED)) {
						this.logger.error('cannot maintain connection to supervisor', err);
						console.error('cannot maintain connection to supervisor', err);
					}
				} finally {
					stopUpdates = undefined;
				}
				await new Promise(resolve => setTimeout(resolve, 1000));
			}
		})();
		this.context.subscriptions.push({
			dispose() {
				run = false;
				if (stopUpdates) {
					stopUpdates();
				}
			}
		});
	}

	async openTunnel(port: number, targetPort: number, privacy?: string) {
		const request = new TunnelPortRequest();
		request.setPort(port);
		request.setTargetPort(targetPort);
		request.setVisibility(privacy === 'public' ? TunnelVisiblity.NETWORK : TunnelVisiblity.HOST);
		await util.promisify(this.port.tunnel.bind(this.port, request, this.metadata, {
			deadline: Date.now() + SupervisorConnection.deadlines.normal
		}))();
	}

	async closeTunnel(port: number) {
		const request = new CloseTunnelRequest();
		request.setPort(port);
		await util.promisify(this.port.closeTunnel.bind(this.port, request, this.metadata, {
			deadline: Date.now() + SupervisorConnection.deadlines.normal
		}))();
	}

	async setTunnelVisibility(port: number, targetPort: number, visibility: TunnelVisiblity): Promise<void> {
		const request = new TunnelPortRequest();
		request.setPort(port);
		request.setTargetPort(targetPort);
		request.setVisibility(visibility);
		await util.promisify(this.port.tunnel.bind(this.port, request, this.metadata, {
			deadline: Date.now() + SupervisorConnection.deadlines.normal
		}))();
	}

	async getWorkspaceInfo() {
		const response = await util.promisify(this.info.workspaceInfo.bind(this.info, new WorkspaceInfoRequest(), this.metadata, {
			deadline: Date.now() + SupervisorConnection.deadlines.long
		}))();
		return response.toObject();
	}
}

type UsedGitpodFunction = ['getWorkspace', 'openPort', 'stopWorkspace', 'setWorkspaceTimeout', 'getWorkspaceTimeout', 'getLoggedInUser', 'takeSnapshot', 'waitForSnapshot', 'controlAdmission', 'sendHeartBeat', 'trackEvent', 'getTeams'];
type Union<Tuple extends any[], Union = never> = Tuple[number] | Union;
export type GitpodConnection = Omit<GitpodServiceImpl<GitpodClient, GitpodServer>, 'server'> & {
	server: Pick<GitpodServer, Union<UsedGitpodFunction>>;
};

export class GitpodExtensionContext implements vscode.ExtensionContext {

	readonly sessionId = uuid.v4();
	readonly pendingActivate: Promise<void>[] = [];
	readonly workspaceContextUrl: vscode.Uri;

	public readonly gitpodYml: GitpodYml;
	public readonly telemetryService: TelemetryService

	constructor(
		private readonly context: vscode.ExtensionContext,
		readonly devMode: boolean,
		readonly supervisor: SupervisorConnection,
		readonly gitpod: GitpodConnection,
		private readonly webSocket: Promise<ReconnectingWebSocket> | undefined,
		readonly pendingWillCloseSocket: (() => Promise<void>)[],
		readonly info: WorkspaceInfoResponse.AsObject,
		readonly owner: Promise<User>,
		readonly userId: string,
		readonly instanceListener: Promise<WorkspaceInstanceUpdateListener>,
		readonly workspaceOwned: boolean,
		readonly logger: ILogService,
		readonly ipcHookCli: string | undefined,
		readonly experiments: ExperimentalSettings
	) {
		this.workspaceContextUrl = vscode.Uri.parse(info.workspaceContextUrl);

		const gitpodFileUri = vscode.Uri.file(path.join(info.checkoutLocation, '.gitpod.yml'));
		this.gitpodYml = new GitpodYml(gitpodFileUri);
		this.context.subscriptions.push(this.gitpodYml);

		const extensionId = context.extension.id;
		const packageJSON = context.extension.packageJSON;

		const piiPaths = [context.extensionPath, context.globalStorageUri.fsPath];
		if (context.storageUri) {
			piiPaths.push(context.storageUri.fsPath);
		}
		this.telemetryService = new TelemetryService(extensionId, packageJSON.version, packageJSON.segmentKey, piiPaths, userId, this.info.gitpodHost, logger);
	}

	get active() {
		Object.freeze(this.pendingActivate);
		return Promise.all(this.pendingActivate.map(p => p.catch(console.error)));
	}

	get subscriptions() {
		return this.context.subscriptions;
	}
	get globalState() {
		return this.context.globalState;
	}
	get workspaceState() {
		return this.context.workspaceState;
	}
	get secrets() {
		return this.context.secrets;
	}
	get extensionUri() {
		return this.context.extensionUri;
	}
	get extensionPath() {
		return this.context.extensionPath;
	}
	get environmentVariableCollection() {
		return this.context.environmentVariableCollection;
	}
	asAbsolutePath(relativePath: string): string {
		return this.context.asAbsolutePath(relativePath);
	}
	get storageUri() {
		return this.context.storageUri;
	}
	get storagePath() {
		return this.context.storagePath;
	}
	get globalStorageUri() {
		return this.context.globalStorageUri;
	}
	get globalStoragePath() {
		return this.context.globalStoragePath;
	}
	get logUri() {
		return this.context.logUri;
	}
	get logPath() {
		return this.context.logPath;
	}
	get extensionMode() {
		return this.context.extensionMode;
	}
	get extension() {
		return this.context.extension;
	}
	get extensionRuntime() {
		return (this.context as any).extensionRuntime;
	}

	async dispose() {
		await this.telemetryService.dispose();

		if (!this.webSocket) {
			return;
		}
		try {
			const ws = await this.webSocket;
			await Promise.allSettled(this.pendingWillCloseSocket.map(f => f()));
			ws.close();
		} catch (e) {
			this.logger.error('failed to dispose context:', e);
			console.error('failed to dispose context:', e);
		}
	}

	async controlPort(port: number, prevStatus: ExposedPortInfo.AsObject | undefined, updateOptions: Partial<Pick<ExposedPortInfo.AsObject, 'visibility' | 'protocol'>>): Promise<void> {
		const protocol = updateOptions.protocol ?? prevStatus?.protocol ?? PortProtocol.HTTP;
		const visibility = updateOptions.visibility ?? prevStatus?.visibility ?? PortVisibility.PRIVATE;

		await this.gitpod.server.openPort(this.info.workspaceId, {
			port,
			protocol: protocol === PortProtocol.HTTPS ? 'https' : 'http',
			visibility: visibility === PortVisibility.PUBLIC ? 'public' : 'private',
		});
	}

	isDebugWorkspace() {
		return this.info.debugWorkspaceType > DebugWorkspaceType.NODEBUG;
	}

	getWorkspaceTelemetryProperties() {
		return {
			workspaceId: this.info.workspaceId,
			instanceId: this.info.instanceId,
			debugWorkspace: String(this.isDebugWorkspace()),
		}
	}
}

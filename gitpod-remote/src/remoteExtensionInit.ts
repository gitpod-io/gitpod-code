/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as cp from 'child_process';
import { GitpodExtensionContext } from 'gitpod-shared';
import * as util from 'util';
import * as path from 'path';

const MAX_EXTENSIONS = 15;

export interface IExtensionIdentifier {
	id: string;
	uuid?: string;
}

export interface ISyncExtension {
	identifier: IExtensionIdentifier;
	preRelease?: boolean;
	version?: string;
	disabled?: boolean;
	installed?: boolean;
	state?: Record<string, any>;
}

let vscodeProductJson: any;
async function getVSCodeProductJson() {
	if (!vscodeProductJson) {
		const productJsonStr = await fs.promises.readFile(path.join(vscode.env.appRoot, 'product.json'), 'utf8');
		vscodeProductJson = JSON.parse(productJsonStr);
	}

	return vscodeProductJson;
}

export async function initializeRemoteExtensions(extensions: ISyncExtension[], context: GitpodExtensionContext) {
	if (!extensions || !extensions.length) {
		return true;
	}

	const productJson = await getVSCodeProductJson();
	const appName = productJson.applicationName || 'code';
	const codeCliPath = path.join(vscode.env.appRoot, 'bin/remote-cli', appName);
	const execEnv = { ...process.env };
	delete execEnv['ELECTRON_RUN_AS_NODE'];

	context.logger.info('Trying to initialize remote extensions:', extensions.map(e => e.identifier.id).join('\n'));
	for (let i = 0; i < extensions.length; i+= MAX_EXTENSIONS) {
		const extensionsChunk = extensions.slice(i, i + MAX_EXTENSIONS);
		if (!extensionsChunk.length) {
			break;
		}

		try {
			const args = extensionsChunk.map(e => '--install-extension ' + e.identifier.id).join(' ');
			const { stdout, stderr } = await util.promisify(cp.exec)(`${codeCliPath} ${args}`, { env: execEnv });
			context.logger.info(`Initialize remote extensions cli commamnd output:\nstdout: ${stdout}\nstderr: ${stderr}`);
		} catch (e) {
			context.logger.error('Error trying to initialize remote extensions:', e);
		}
	}

	return true;
}

export async function installInitialExtensions(context: GitpodExtensionContext) {
	context.logger.info('installing initial extensions...');
	const extensions: (vscode.Uri | string)[] = [];
	try {
		const workspaceContextUri = vscode.Uri.parse(context.info.workspaceContextUrl);
		extensions.push('redhat.vscode-yaml');
		if (/github\.com/i.test(workspaceContextUri.authority)) {
			extensions.push('github.vscode-pull-request-github');
		}

		let config: { vscode?: { extensions?: string[] } } | undefined;
		try {
			const model = await context.gitpodYml.getYaml();
			config = model.document.toJSON();
		} catch { }
		if (config?.vscode?.extensions) {
			const extensionIdRegex = /^([^.]+\.[^@]+)(@(\d+\.\d+\.\d+(-.*)?))?$/;
			for (const extension of config.vscode.extensions) {
				let link: vscode.Uri | undefined;
				try {
					link = vscode.Uri.parse(extension.trim(), true);
					if (link.scheme !== 'http' && link.scheme !== 'https') {
						link = undefined;
					}
				} catch { }
				if (link) {
					extensions.push(link);
				} else {
					const normalizedExtension = extension.toLocaleLowerCase();
					if (extensionIdRegex.exec(normalizedExtension)) {
						extensions.push(normalizedExtension);
					}
				}
			}
		}
	} catch (e) {
		context.logger.error('Failed to detect workspace context dependent extensions:', e);
	}

	if (!extensions.length) {
		return;
	}

	const productJson = await getVSCodeProductJson();
	const appName = productJson.applicationName || 'code';
	const codeCliPath = path.join(vscode.env.appRoot, 'bin/remote-cli', appName);
	const execEnv = { ...process.env };
	delete execEnv['ELECTRON_RUN_AS_NODE'];

	context.logger.info('Trying to initialize remote extensions from gitpod.yml:', extensions.map(e => e.toString()).join('\n'));
	for (let i = 0; i < extensions.length; i+= MAX_EXTENSIONS) {
		const extensionsChunk = extensions.slice(i, i + MAX_EXTENSIONS);
		if (!extensionsChunk.length) {
			break;
		}

		try {
			const args = extensionsChunk.map(e => '--install-extension ' + e.toString()).join(' ');
			const { stdout, stderr } = await util.promisify(cp.exec)(`${codeCliPath} ${args}`, { env: execEnv });
			context.logger.info(`Initialize remote extensions cli commamnd output:\nstdout: ${stdout}\nstderr: ${stderr}`);
		} catch (e) {
			context.logger.error('Error trying to initialize remote extensions from gitpod.yml:', e);
		}
	}
}

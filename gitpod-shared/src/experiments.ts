/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as configcat from 'configcat-node';
import * as configcatcommon from 'configcat-common';
import Log from './common/logger';
import { URL } from 'url';
import { Team, User } from '@gitpod/gitpod-protocol';

const experimentsSection = 'gitpod.experiments';

export type EXPERIMENTAL_SETTINGS = 'gitpod.experiments.rebuildHints';

export class ExperimentalSettings {
	private configcatClient: configcatcommon.IConfigCatClient;

	constructor(
		key: string,
		context: vscode.ExtensionContext,
		private logger: Log,
		gitpodHost: string,
		private readonly pendingOwner: Promise<User>,
		private readonly pendingTeams: Promise<Team[]>,
	) {
		this.configcatClient = configcat.createClientWithLazyLoad(key, {
			baseUrl: new URL('/configcat', context.extensionMode === vscode.ExtensionMode.Production ? gitpodHost : 'https://gitpod-staging.com').href,
			logger: {
				debug(): void { },
				log(): void { },
				info(): void { },
				warn(message: string): void { logger.warn(`ConfigCat: ${message}`); },
				error(message: string): void { logger.error(`ConfigCat: ${message}`); }
			},
			requestTimeoutMs: 1500,
			cacheTimeToLiveSeconds: 60
		});
	}

	async get<T>(key: EXPERIMENTAL_SETTINGS): Promise<T | undefined> {
		const config = vscode.workspace.getConfiguration(experimentsSection);
		const values = config.inspect<T>(key.substring((experimentsSection + '.').length));
		if (!values) {
			this.logger.error(`Cannot get invalid experimental setting '${key}'`);
			return undefined;
		}
		if (values.globalValue !== undefined) {
			// User setting have priority over configcat so return early
			return values.globalValue;
		}
		const experimentValue = await this.getExperimentValue<T>(key);
		return experimentValue ?? values.defaultValue;
	}

	private async getExperimentValue<T>(key: string): Promise<T | undefined> {
		const configcatKey = key.replace(/\./g, '_'); // '.' are not allowed in configcat
		const unresolved = '__unressssolved__'

		const user = await this.pendingOwner;
		const email = User.getPrimaryEmail(user);
		const teams = await this.pendingTeams;
		if (teams.length) {
			for (const team of teams) {
				const value = (await this.configcatClient.getValueAsync(configcatKey, unresolved, this.getConfigcatUser(user.id, email, team.id)));
				if (value != unresolved) {
					return value as T;
				}
			}
		} else {
			const value = (await this.configcatClient.getValueAsync(configcatKey, unresolved, this.getConfigcatUser(user.id, email, undefined)));
			if (value != unresolved) {
				return value as T;
			}
		}
		return undefined;
	}

	private getConfigcatUser(userId: string, email: string | undefined, teamId: string | undefined): configcatcommon.User {
		const attributes: { [key: string]: string } = {
			"user_id": userId
		}
		if (email) {
			attributes["user_email"] = email;
		}
		if (teamId) {
			attributes["team_id"] = teamId;
		}
		return new configcatcommon.User(userId, email, undefined, attributes);
	}

	dispose(): void {
		this.configcatClient.dispose();
	}
}

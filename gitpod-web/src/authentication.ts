/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import fetch from 'node-fetch';
import { Disposable, GitpodExtensionContext } from 'gitpod-shared';
import Keychain from './util/keychain';

interface SessionData {
    id: string;
    account?: {
        label?: string;
        displayName?: string;
        id: string;
    };
    scopes: string[];
    accessToken: string;
}

interface UserInfo {
    id: string;
    accountName: string;
}

export class GitpodAuthenticationProvider extends Disposable implements vscode.AuthenticationProvider {
    private _sessionChangeEmitter = this._register(new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>());

    private _keychain: Keychain;

    private _sessionsPromise: Promise<vscode.AuthenticationSession[]>;

    constructor(private context: GitpodExtensionContext) {
        super();

        this._keychain = new Keychain(context, `gitpod.auth`, context.logger);

        this._sessionsPromise = this.readSessions();

        this._register(vscode.authentication.registerAuthenticationProvider('gitpod', 'Gitpod', this, { supportsMultipleAccounts: false }));
    }

    get onDidChangeSessions() {
        return this._sessionChangeEmitter.event;
    }

    private async resolveGitpodUser(): Promise<UserInfo> {
        const owner = await this.context.owner;
        return {
            id: owner.id,
            accountName: owner.name!
        };
    }

    private async readSessions(): Promise<vscode.AuthenticationSession[]> {
        let sessionData: SessionData[];
        try {
            this.context.logger.info('Reading sessions from keychain...');
            let storedSessions = await this._keychain.getToken();
            if (!storedSessions) {
                return [];
            }
            this.context.logger.info('Got stored sessions!');

            try {
                sessionData = JSON.parse(storedSessions);
            } catch (e) {
                await this._keychain.deleteToken();
                throw e;
            }
        } catch (e) {
            this.context.logger.error(`Error reading token: ${e}`);
            return [];
        }

        const sessionPromises = sessionData.map(async (session: SessionData) => {
            // For the Gitpod scope list, order doesn't matter so we immediately sort the scopes
            const sortedScopes = session.scopes.sort();
            const scopesStr = sortedScopes.join(' ');

            let userInfo: UserInfo | undefined;
            try {
                userInfo = await this.resolveGitpodUser();
                this.context.logger.info(`Verified session with the following scopes: ${scopesStr}`);
            } catch (e) {
                // Remove sessions that return unauthorized response
                if (e.message.includes('Unexpected server response: 401')) {
                    return undefined;
                }
                this.context.logger.error(`Error while verifying session with the following scopes: ${scopesStr}`, e);
            }

            this.context.logger.trace(`Read the following session from the keychain with the following scopes: ${scopesStr}`);
            return {
                id: session.id,
                account: {
                    label: session.account
                        ? session.account.label ?? session.account.displayName ?? '<unknown>'
                        : userInfo?.accountName ?? '<unknown>',
                    id: session.account?.id ?? userInfo?.id ?? '<unknown>'
                },
                scopes: sortedScopes,
                accessToken: session.accessToken
            };
        });

        const verifiedSessions = (await Promise.allSettled(sessionPromises))
            .filter(p => p.status === 'fulfilled')
            .map(p => (p as PromiseFulfilledResult<vscode.AuthenticationSession | undefined>).value)
            .filter(<T>(p?: T): p is T => Boolean(p));

        this.context.logger.info(`Got ${verifiedSessions.length} verified sessions.`);

        return verifiedSessions;
    }

    async getSessions(scopes?: string[]) {
        const sortedScopes = scopes?.slice().sort() || [];
        this.context.logger.info(`Getting sessions for ${sortedScopes.length ? sortedScopes.join(',') : 'all scopes'}...`);

        const sessions = await this._sessionsPromise;

        const finalSessions = sortedScopes.length
            ? sessions.filter(session => sortedScopes.every(s => session.scopes.includes(s)))
            : sessions;

        this.context.logger.info(`Got ${finalSessions.length} sessions for ${sortedScopes.join(',') || 'all scopes'}...`);
        return finalSessions;
    }

    async createSession(_scopes: string[]): Promise<vscode.AuthenticationSession> {
        throw new Error('not supported');
    }

    async removeSession() {
        throw new Error('not supported');
    }
}

export class GithubAuthenticationProvider extends Disposable implements vscode.AuthenticationProvider {
    private _sessionChangeEmitter = this._register(new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>());

    private _sessionsPromise: Promise<vscode.AuthenticationSession[]>;

    constructor(private context: GitpodExtensionContext) {
        super();

        this._sessionsPromise = this.loginGitHub([]).then(s => [s]).catch(e => { context.logger.error('Failed at initial GitHub login:', e); return []; });

        this._register(vscode.authentication.registerAuthenticationProvider('github', 'GitHub', this, { supportsMultipleAccounts: false }));
    }

    get onDidChangeSessions() {
        return this._sessionChangeEmitter.event;
    }

    async getSessions(scopes?: string[]) {
        const sortedScopes = scopes?.slice().sort() || [];
        this.context.logger.info(`Getting GitHub sessions for ${sortedScopes.length ? sortedScopes.join(',') : 'all scopes'}...`);

        const sessions = await this._sessionsPromise;

        const finalSessions = sortedScopes.length
            ? sessions.filter(session => sortedScopes.every(s => session.scopes.includes(s)))
            : sessions;

        this.context.logger.info(`Got ${finalSessions.length} GitHub sessions for ${sortedScopes.join(',') || 'all scopes'}...`);
        return finalSessions;
    }

    private async resolveGitHubUser(accessToken: string): Promise<UserInfo> {
        const userResponse = await fetch('https://api.github.com/user', {
            headers: {
                Authorization: `token ${accessToken}`,
                'User-Agent': 'Gitpod-Code'
            }
        });
        if (!userResponse.ok) {
            throw new Error(`Getting GitHub account info failed: ${userResponse.statusText}`);
        }
        const user = await (userResponse.json() as Promise<{ id: string; login: string }>);
        return {
            id: user.id,
            accountName: user.login
        };
    }

    private async loginGitHub(scopes: string[]): Promise<vscode.AuthenticationSession> {
        const resp = await this.context.supervisor.getToken(
            'git',
            'github.com',
            scopes
        );
        const userInfo = await this.resolveGitHubUser(resp.token);

        const session = {
            id: 'github-session',
            account: {
                label: userInfo?.accountName ?? '<unknown>',
                id: userInfo?.id ?? '<unknown>'
            },
            scopes: resp.scopeList,
            accessToken: resp.token
        }

        return session;
    }

    async createSession(scopes: string[]) {
        try {
            const session = await this.loginGitHub(scopes.slice());

            this._sessionsPromise = Promise.resolve([session]);

            this._sessionChangeEmitter.fire({ added: [session], changed: [], removed: [] });

            return session;
        } catch (e) {
            this.context.logger.error('GitHub sign in failed: ', e);
            throw e;
        }
    }

    async removeSession(id: string) {
        try {
            this.context.logger.info(`Logging out of ${id}`);

            const sessions = await this._sessionsPromise;
            const sessionIndex = sessions.findIndex(session => session.id === id);
            if (sessionIndex > -1) {
                const session = sessions[sessionIndex];
                sessions.splice(sessionIndex, 1);

                this._sessionsPromise = Promise.resolve(sessions);

                this._sessionChangeEmitter.fire({ added: [], removed: [session], changed: [] });
            } else {
                this.context.logger.error('Session not found');
            }
        } catch (e) {
            this.context.logger.error(e);
            throw e;
        }
    }
}

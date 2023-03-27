/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import * as vscode from 'vscode';
import { GitpodExtensionContext } from './gitpodContext';

const activeLanguages = new Set<String>();
export function registerActiveLanguageAnalytics(context: GitpodExtensionContext): void {
	const track = () => {
		const e = vscode.window.activeTextEditor;
		if (!e || activeLanguages.has(e.document.languageId)) {
			return;
		}
		const lang = e.document.languageId;
		activeLanguages.add(lang);
		const ext = path.extname(e.document.uri.path) || '';
		context.telemetryService.sendTelemetryEvent('vscode_active_language', {
			...context.getWorkspaceTelemetryProperties(),
			lang,
			ext
		});
	};
	track();
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => track()));
}

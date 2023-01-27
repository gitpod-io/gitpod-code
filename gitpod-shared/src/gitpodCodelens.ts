/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { exists } from './common/utils';
import { GitpodExtensionContext } from './gitpodContext';

const BuildAction = {
	command: 'gitpod.gitpodyml.build',
	title: 'Build',
	description: 'Build Gitpod Configuration',
	shellCommand: 'gp-run --all-commands=false',

	dockerfileCommand: 'gitpod.gitpodyml.dockerfile.build',
	dockerfileEditorContextCommand: 'gitpod.gitpodyml.dockerfile.editorContext.build',
	dockerfileEditorTitleCommand: 'gitpod.gitpodyml.dockerfile.editorTitle.build',
	editorContextCommand: 'gitpod.gitpodyml.editorContext.build',
	editorTitleCommand: 'gitpod.gitpodyml.editorTitle.build',
};
const RunAction = {
	command: 'gitpod.gitpodyml.run',
	title: 'Test',
	description: 'Test Gitpod Configuration',
	shellCommand: 'gp-run',

	dockerfileCommand: 'gitpod.gitpodyml.dockerfile.run',
	dockerfileEditorContextCommand: 'gitpod.gitpodyml.dockerfile.editorContext.run',
	dockerfileEditorTitleCommand: 'gitpod.gitpodyml.dockerfile.editorTitle.run',
	editorContextCommand: 'gitpod.gitpodyml.editorContext.run',
	editorTitleCommand: 'gitpod.gitpodyml.editorTitle.run',
};
const FeedbackAction = {
	command: 'gitpod.gitpodyml.feedback',
	title: 'Feedback',
	description: 'Leave feedback on the Gitpod configuration experience',
	url: 'https://github.com/gitpod-io/gitpod/issues/7671',

	dockerfileCommand: 'gitpod.gitpodyml.dockerfile.feedback',
};
const LearnAction = {
	command: 'gitpod.gitpodyml.learn',
	title: 'Learn',
	description: 'Learn more about configuring a Gitpod workspace',
	url: 'https://www.gitpod.io/docs/references/gitpod-yml',

	dockerfileCommand: 'gitpod.gitpodyml.dockerfile.learn',
};

export class GitpodYamlCodelensProvider implements vscode.CodeLensProvider {

	private dockerFileUri: vscode.Uri | undefined;

	constructor() {
	}

	public setDockerFile(uri: vscode.Uri | undefined) {
		this.dockerFileUri = uri;
	}

	public provideCodeLenses(document: vscode.TextDocument, _tkn: vscode.CancellationToken): vscode.CodeLens[] {
		const isDockerFile = document.fileName.endsWith('Dockerfile');
		if (isDockerFile && (!this.dockerFileUri || document.uri.fsPath !== this.dockerFileUri.fsPath)) {
			return [];
		}

		const text = document.getText();
		const match = /(.+)/.exec(text);
		if (match) {
			const line = document.lineAt(document.positionAt(match.index).line);
			return [
				new vscode.CodeLens(line.range, {
					title: BuildAction.title,
					tooltip: BuildAction.description,
					command: isDockerFile ? BuildAction.dockerfileCommand : BuildAction.command,
				}),
				new vscode.CodeLens(line.range, {
					title: RunAction.title,
					tooltip: RunAction.description,
					command: isDockerFile ? RunAction.dockerfileCommand : RunAction.command,
				}),
				new vscode.CodeLens(line.range, {
					title: LearnAction.title,
					tooltip: LearnAction.description,
					command: isDockerFile ? LearnAction.dockerfileCommand : LearnAction.command,
				}),
				new vscode.CodeLens(line.range, {
					title: FeedbackAction.title,
					tooltip: FeedbackAction.description,
					command: isDockerFile ? FeedbackAction.dockerfileCommand : FeedbackAction.command,
				}),
			];
		}
		return [];
	}

	public resolveCodeLens(codeLens: vscode.CodeLens, _tkn: vscode.CancellationToken) {
		return codeLens;
	}
}

export class GitpodCodelens extends vscode.Disposable {
	private disposables: vscode.Disposable[] = [];

	private codelensProvider = new GitpodYamlCodelensProvider();

	private dockerFileUri: vscode.Uri | undefined;

	private async initiateUserTask(taskAction: typeof BuildAction) {
		const allTasksExecutions = vscode.tasks.taskExecutions;
		const isTaskRunning = allTasksExecutions.find(task => task.task.source === taskAction.command);
		if (isTaskRunning) {
			const restart = 'Restart task';
			const cancel = 'Terminate task';
			const action = await vscode.window.showWarningMessage(`The ${taskAction.description} Task is already running`, { modal: true }, restart, cancel);

			if (action) {
				isTaskRunning.terminate();
			}

			if (action === cancel) {
				return;
			}
		}

		await vscode.tasks.executeTask(
			new vscode.Task(
				{ type: 'shell' },
				vscode.TaskScope.Workspace,
				taskAction.description,
				taskAction.command,
				new vscode.ShellExecution(taskAction.shellCommand)));
	}

	constructor(private context: GitpodExtensionContext) {
		super(() => { });

		this.initialize();

		this.disposables.push(this.context.gitpodYml.onDidChangeGitpodYml(() => {
			this.updateDockerFile();
		}));
		this.disposables.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
			const isGitpodDockerfile = !!editor && !!this.dockerFileUri && editor.document.uri.fsPath === this.dockerFileUri.fsPath;
			vscode.commands.executeCommand('setContext', 'gitpod.run-gp.dockerfile', isGitpodDockerfile);
		}));
	}

	async initialize(): Promise<void> {
		if (!(await exists('/ide/bin/run-gp-cli/gp-run'))) {
			return;
		}

		await vscode.commands.executeCommand('setContext', 'gitpod.run-gp.enabled', true);

		await this.updateDockerFile();

		this.disposables.push(vscode.languages.registerCodeLensProvider({ pattern: '**/.gitpod.yml' }, this.codelensProvider));
		this.disposables.push(vscode.languages.registerCodeLensProvider({ pattern: '**/{*.Dockerfile,Dockerfile}' }, this.codelensProvider));

		this.disposables.push(vscode.commands.registerCommand(BuildAction.command, async () => {
			this.context.fireAnalyticsEvent({
				eventName: 'vscode_execute_command_inner_loop',
				properties: {
					action: 'build',
					location: 'codelens',
					source: 'gitpodYml'
				}
			});
			await this.initiateUserTask(BuildAction);
		}));
		this.disposables.push(vscode.commands.registerCommand(RunAction.command, async () => {
			this.context.fireAnalyticsEvent({
				eventName: 'vscode_execute_command_inner_loop',
				properties: {
					action: 'run',
					location: 'codelens',
					source: 'gitpodYml'
				}
			});
			await this.initiateUserTask(RunAction);
		}));
		this.disposables.push(vscode.commands.registerCommand(LearnAction.command, () => {
			this.context.fireAnalyticsEvent({
				eventName: 'vscode_execute_command_inner_loop',
				properties: {
					action: 'learn',
					location: 'codelens',
					source: 'gitpodYml'
				}
			});
			return vscode.env.openExternal(vscode.Uri.parse(LearnAction.url));
		}));
		this.disposables.push(vscode.commands.registerCommand(FeedbackAction.command, () => {
			this.context.fireAnalyticsEvent({
				eventName: 'vscode_execute_command_inner_loop',
				properties: {
					action: 'feedback',
					location: 'codelens',
					source: 'gitpodYml'
				}
			});
			return vscode.env.openExternal(vscode.Uri.parse(FeedbackAction.url));
		}));

		// Duplicate commands just for analytics
		this.disposables.push(vscode.commands.registerCommand(BuildAction.dockerfileCommand, async () => {
			this.context.fireAnalyticsEvent({
				eventName: 'vscode_execute_command_inner_loop',
				properties: {
					action: 'build',
					location: 'codelens',
					source: 'dockerfile'
				}
			});
			await this.initiateUserTask(BuildAction);
		}));
		this.disposables.push(vscode.commands.registerCommand(RunAction.dockerfileCommand, async () => {
			this.context.fireAnalyticsEvent({
				eventName: 'vscode_execute_command_inner_loop',
				properties: {
					action: 'run',
					location: 'codelens',
					source: 'dockerfile'
				}
			});
			await this.initiateUserTask(RunAction);
		}));
		this.disposables.push(vscode.commands.registerCommand(LearnAction.dockerfileCommand, () => {
			this.context.fireAnalyticsEvent({
				eventName: 'vscode_execute_command_inner_loop',
				properties: {
					action: 'learn',
					location: 'codelens',
					source: 'dockerfile'
				}
			});
			return vscode.env.openExternal(vscode.Uri.parse(LearnAction.url));
		}));
		this.disposables.push(vscode.commands.registerCommand(FeedbackAction.dockerfileCommand, () => {
			this.context.fireAnalyticsEvent({
				eventName: 'vscode_execute_command_inner_loop',
				properties: {
					action: 'feedback',
					location: 'codelens',
					source: 'dockerfile'
				}
			});
			return vscode.env.openExternal(vscode.Uri.parse(FeedbackAction.url));
		}));
		this.disposables.push(vscode.commands.registerCommand(BuildAction.editorContextCommand, async () => {
			this.context.fireAnalyticsEvent({
				eventName: 'vscode_execute_command_inner_loop',
				properties: {
					action: 'build',
					location: 'editorContext',
					source: 'gitpodYml'
				}
			});
			await this.initiateUserTask(BuildAction);
		}));
		this.disposables.push(vscode.commands.registerCommand(RunAction.editorContextCommand, async () => {
			this.context.fireAnalyticsEvent({
				eventName: 'vscode_execute_command_inner_loop',
				properties: {
					action: 'run',
					location: 'editorContext',
					source: 'gitpodYml'
				}
			});
			await this.initiateUserTask(RunAction);
		}));
		this.disposables.push(vscode.commands.registerCommand(BuildAction.dockerfileEditorContextCommand, async () => {
			this.context.fireAnalyticsEvent({
				eventName: 'vscode_execute_command_inner_loop',
				properties: {
					action: 'build',
					location: 'editorContext',
					source: 'dockerfile'
				}
			});
			await this.initiateUserTask(BuildAction);
		}));
		this.disposables.push(vscode.commands.registerCommand(RunAction.dockerfileEditorContextCommand, async () => {
			this.context.fireAnalyticsEvent({
				eventName: 'vscode_execute_command_inner_loop',
				properties: {
					action: 'run',
					location: 'editorContext',
					source: 'dockerfile'
				}
			});
			await this.initiateUserTask(RunAction);
		}));
		this.disposables.push(vscode.commands.registerCommand(BuildAction.editorTitleCommand, async () => {
			this.context.fireAnalyticsEvent({
				eventName: 'vscode_execute_command_inner_loop',
				properties: {
					action: 'build',
					location: 'editorTitle',
					source: 'gitpodYml'
				}
			});
			await this.initiateUserTask(BuildAction);
		}));
		this.disposables.push(vscode.commands.registerCommand(RunAction.editorTitleCommand, async () => {
			this.context.fireAnalyticsEvent({
				eventName: 'vscode_execute_command_inner_loop',
				properties: {
					action: 'run',
					location: 'editorTitle',
					source: 'gitpodYml'
				}
			});
			await this.initiateUserTask(RunAction);
		}));
		this.disposables.push(vscode.commands.registerCommand(BuildAction.dockerfileEditorTitleCommand, async () => {
			this.context.fireAnalyticsEvent({
				eventName: 'vscode_execute_command_inner_loop',
				properties: {
					action: 'build',
					location: 'editorTitle',
					source: 'dockerfile'
				}
			});
			await this.initiateUserTask(BuildAction);
		}));
		this.disposables.push(vscode.commands.registerCommand(RunAction.dockerfileEditorTitleCommand, async () => {
			this.context.fireAnalyticsEvent({
				eventName: 'vscode_execute_command_inner_loop',
				properties: {
					action: 'run',
					location: 'editorTitle',
					source: 'dockerfile'
				}
			});
			await this.initiateUserTask(RunAction);
		}));
	}

	private async updateDockerFile() {
		const yaml = await this.context.gitpodYml.getYaml();
		const dockerfile = yaml.document.getIn(['image', 'file']);
		if (dockerfile) {
			const dir = path.posix.dirname(this.context.gitpodYml.uri.path);
			this.dockerFileUri = this.context.gitpodYml.uri.with({ path: path.join(dir, dockerfile) });
		} else {
			this.dockerFileUri = undefined;
		}
		this.codelensProvider.setDockerFile(this.dockerFileUri);
	}

	override dispose() {
		this.disposables.forEach(d => d.dispose());
	}
}

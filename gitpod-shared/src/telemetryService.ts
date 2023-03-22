/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppenderData, BaseTelemetryAppender, BaseTelemetryClient, BaseTelemetryReporter } from './common/telemetry';
import { Analytics } from '@segment/analytics-node';
import * as os from 'os';
import * as vscode from 'vscode';

const analyticsClientFactory = async (key: string): Promise<BaseTelemetryClient> => {
	let segmentAnalyticsClient = new Analytics({ writeKey: key });

	// Sets the analytics client into a standardized form
	const telemetryClient: BaseTelemetryClient = {
		logEvent: (eventName: string, data?: AppenderData) => {
			try {
				segmentAnalyticsClient.track({
					anonymousId: vscode.env.machineId,
					event: eventName,
					properties: data?.properties
				});
			} catch (e: any) {
				console.error('Failed to log event to app analytics!', e);
			}
		},
		logException: (_exception: Error, _data?: AppenderData) => {
            throw new Error('Failed to log exception to app analytics!\n');
		},
		flush: async () => {
			try {
				await segmentAnalyticsClient.closeAndFlush({ timeout: 3000 });
			} catch (e: any) {
				console.error('Failed to flush app analytics!', e);
			}
		}
	};
	return telemetryClient;
};

export class TelemetryService extends BaseTelemetryReporter {
	constructor(extensionId: string, extensionVersion: string, key: string) {
		const appender = new BaseTelemetryAppender(key, (key) => analyticsClientFactory(key));
		super(extensionId, extensionVersion, appender, {
			release: os.release(),
			platform: os.platform(),
			architecture: os.arch(),
		});
	}
}

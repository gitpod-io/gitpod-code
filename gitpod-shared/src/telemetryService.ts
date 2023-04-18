/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppenderData, BaseTelemetryAppender, BaseTelemetryClient, BaseTelemetryReporter } from './common/telemetry';
import { Analytics, AnalyticsSettings } from '@segment/analytics-node';
import * as os from 'os';
import { ILogService } from './logService';

type RequireKeys<T extends object, K extends keyof T> =
	Required<Pick<T, K>> & Omit<T, K>;

export type TelemetrySettings = RequireKeys<AnalyticsSettings, 'writeKey' | 'host' | 'path'>

const analyticsClientFactory = async (pendingUserId: Promise<string>, settings: TelemetrySettings, logger: ILogService): Promise<BaseTelemetryClient> => {
	const userId = await pendingUserId;
	let segmentAnalyticsClient = new Analytics(settings);
	logger.debug("analytics: " + new URL(settings.path, settings.host).href.replace(/\/$/, '')); // aligned with how segment does it internally

	// Sets the analytics client into a standardized form
	const telemetryClient: BaseTelemetryClient = {
		logEvent: (eventName: string, data?: AppenderData) => {
			try {
				segmentAnalyticsClient.track({
					userId,
					event: eventName,
					properties: data?.properties
				}, (e) => {
					if (e) {
						logger.error('Failed to log event to app analytics:', e);
					}
				});
			} catch (e: any) {
				logger.error('Failed to log event to app analytics:', e);
			}
		},
		logException: (_exception: Error, _data?: AppenderData) => {
			throw new Error('Failed to log exception to app analytics!\n');
		},
		flush: async () => {
			try {
				await segmentAnalyticsClient.closeAndFlush({ timeout: 3000 });
			} catch (e: any) {
				logger.error('Failed to flush app analytics!', e);
			}
		}
	};
	return telemetryClient;
};

export class TelemetryService extends BaseTelemetryReporter {
	constructor(extensionId: string, extensionVersion: string, userId: Promise<string>, settings: TelemetrySettings, logger: ILogService) {
		const appender = new BaseTelemetryAppender(() => analyticsClientFactory(userId, settings, logger));
		super(extensionId, extensionVersion, appender, {
			release: os.release(),
			platform: os.platform(),
			architecture: os.arch(),
		});
	}
}

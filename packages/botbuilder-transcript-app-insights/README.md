# Application Insights Transcript Store for Microsoft Bot Framework
 
This directory contains sample code that can be used to build a [TranscriptLogger](https://github.com/Microsoft/botbuilder-js/blob/master/libraries/botbuilder-core/src/transcriptLogger.ts) that stores and queries bot transcripts backed by Application Insights.

## Prerequisites

- An [App Insights](https://docs.microsoft.com/en-us/azure/application-insights/app-insights-nodejs-quick-start) deployment  
- A NodeJS bot using [Bot Framework v4](https://docs.microsoft.com/en-us/azure/bot-service/?view=azure-bot-service-4.0)

## Install

Because this package is provided as sample code, it is not available on npm and it comes with no guarantee of support or updates. To use this software in your own app:

1. clone this repo
2. `cd botbuilder-utils-js/packages/botbuilder-transcript-app-insights`
3. `npm install`
4. `cd {your-app}`
5. `npm install file:path-to-botbuilder-utils-js/packages/botbuilder-transcript-app-insights`
6. `npm install applicationinsights` (if you don't already have it)

> To support CI and other automation tasks, you may also choose to publish this package on a private npm repo, or simply copy the code/dependencies into your own app.

## Usage

> JavaScript example is shown below, but this package also works great in TypeScript projects.

```JavaScript
const { BotFrameworkAdapter, TranscriptLoggerMiddleware } = require('botbuilder');
const { AppInsightsTranscriptStore } = require('botbuilder-transcript-app-insights');
const { TelemetryClient } = require('applicationinsights'); 

// App Insights configuration
const appInsightsIKey = '<INSTRUMENTATION-KEY>';
const client = new TelemetryClient(appInsightsIKey);

// Attach store to middleware and bot
const store = new AppInsightsTranscriptStore(client);
const logger = new TranscriptLoggerMiddleware(store);
const adapter = new BotFrameworkAdapter({
	appId: process.env.MICROSOFT_APP_ID,
	appPassword: process.env.MICROSOFT_APP_PASSWORD,
}).use(logger);
```

Attaching the middleware to your bot adapter logs every incoming and outgoing Activity between the user and the bot to your App Insights instance.

## API

### AppInsightsTranscriptStore (class)

```TypeScript
constructor(client: TelemetryClient, options?: AppInsightsTranscriptOptions)
```

* `client`: Provide your configured App Insights TelemetryClient instance from the `applicationinsights` package.
* `options` Optional configuration parameters
* `options.query` Optional, only needed if you will call the data access functions to retrieve transcripts and activities.
* `options.query.applicationId` (`string`): Application id for API access
* `options.query.readKey` (`string`): API access key with _Read telemetry_ permissions
* `options.filterableActivityProperties` (`string[]`): Optional nested values on each Activity object that should be promoted as a queryable AppInsights property. Use dot notation to access nested property members. See [usage](#usage) for examples.

> Learn how to [get your API key and Application ID](https://dev.applicationinsights.io/documentation/Authorization/API-key-and-App-ID)

This class implements the [TranscriptStore](https://github.com/Microsoft/botbuilder-js/blob/master/libraries/botbuilder-core/src/transcriptLogger.ts#L154-L183) interface, which includes functions to support retrieval of transcripts and activities.

This class does _not_ implement `deleteTranscript()` due to the immutable nature of App Insights records. Calling this function will result in a thrown `Error`.

## Schema

> Learn more about [App Insights Analytics](https://docs.microsoft.com/en-us/azure/application-insights/app-insights-analytics).

Each transcript activity is stored in App Insights as a `customEvent`. Because [customEvent properties](https://docs.microsoft.com/en-us/azure/application-insights/app-insights-api-custom-events-metrics#properties) are always `string` values, activities are stored in a special way:

* All top-level string values of the activity are stored verbatim as filterable properties
* Any non-string values of the activity (arrays, complex objects, number, boolean, Date) are stored as JSON-encoded strings. These property names are prefixed by a `_` character.
* Select nested activity strings are copied to top-level properties so that they can be used in App Insights analytics filters. These property names are prefixed by a `$` character:
	* `$conversationId` <= `activity.conversation.id`
	* `$fromId` <= `activity.from.id`
	* `$recipientId` <= `activity.recipient.id`
	* `$timestamp` <= `activity.timestamp.toISOString()`
	* `$start` (if this is the first activity in the conversation)

> due to concurrency, multiple records belonging to a single conversation may be flagged as `start`, and they should be de-duped in the results by sorting on `timestamp`.

Here are some example properties from a customEvent record:

| Property | Value (string) |
| -------- | -------------- |
| id | `g17a2nle29eg` |
| type | `conversationUpdate` |
| timestamp | `2018-08-29T14:29:13.1450000Z` |
| $conversationId | `06c8jb90efga9` |
| _conversation | `{"id":"06c8jb90efga9"}` |
| $recipientId | `default-bot` |
| $timestamp | `2018-08-29T14:29:13.1450000Z` |
| serviceUrl | `http://localhost:60086` |
| _recipient | `{"id":"default-bot","name":"Bot"}` |
| channelId | `emulator` |
| $fromId | `default-user` |
| $start | `true` |
| _from | `{"id":"default-user","name":"User","role":"user"}` |
| localTimestamp | `2018-08-29T14:29:13.0000000Z` |
| _membersAdded | `[{"id":"default-bot","name":"Bot"}]` |

[Sample queries](./src/index.ts#L38-L50) are available in this package's implementation.

## Using Activity Trace Properties in Analytics Queries

Every custom event written to App Insights may supply supplementary properties in the form of key/value string pairs. These are also known as an event's _customDimensions_.

`AppInsightsTranscriptStore` automatically promotes select Activity values as filterable Analytics properties (see [schema](#schema)).

If you need to promote additional Activity properties as filterable Analytics properties, you can pass them along in the [constructor parameters](#appinsightstranscriptstore-class). The primary reason to do this is to capture `trace` activity content from utilities like [QnAMaker](https://github.com/Microsoft/botbuilder-js/blob/master/libraries/botbuilder-ai/src/qnaMaker.ts#L231-L239), [LUIS](https://github.com/Microsoft/botbuilder-js/blob/master/libraries/botbuilder-ai/src/luisRecognizer.ts#L213-L222), and [Feedback](../botbuilder-feedback#schema).

Promoted property values are accessed using `lodash.get` and property names are serialized using `lodash.camelcase` (with a prefix of `$`). See the following code for an example

> Trace activity properties are always _stored_ in full, but they are not _filterable_ unless so configured.

```JavaScript
// qnamaker trace configuration
// your app may need zero or more of these, depending on your analytics requirements
const store = new AppInsightsTranscriptStore(client, {
	filterableActivityProperties: [
		'value.knowledgeBaseId',
		'value.queryResults[0].questions[0]',
		'value.queryResults[0].answer',
		'value.queryResults[0].score',
		'value.queryResults[0].source',
	],
});
```

You can now write an Analytics query that targets these values in a filter:

```
customEvents
| where customDimensions.type == 'trace'
	and customDimensions.$valueKnowledgeBaseId == 'kb123'
	and customDimensions.$valueQueryResults0Questions0 == 'foo'
```
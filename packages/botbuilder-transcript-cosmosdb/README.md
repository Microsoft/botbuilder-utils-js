# Botbuilder Transcript Store for CosmosDB


## Install
> This package is currently published to a private npm repo at https://msdata.pkgs.visualstudio.com/_packaging/botbuilder-utils/npm/registry/
>
> For access, please contact chstone.

`npm i botbuilder@4.0.0-aicat1.2 botbuilder-transcript-cosmosdb documentdb @types/documentdb`

## Usage

```TypeScript
import { BotFrameworkAdapter, TranscriptLoggerMiddleware } from 'botbuilder';
import { DocumentClient } from 'documentdb';
import { CosmosDbTranscriptStore } from 'botbuilder-transcript-cosmosdb';

const documentdb = new DocumentClient(process.env.DOCUMENTDB_URL, { masterKey: process.env.DOCUMENTDB_KEY });
const logstore = new CosmosDbTranscriptStore(documentdb);
const logger = new TranscriptLoggerMiddleware(logstore);
const adapter = new BotFrameworkAdapter({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD,
  }).use(logger);

// attach adapter to web server normally
```
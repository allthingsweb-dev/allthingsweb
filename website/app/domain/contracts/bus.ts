import { QueryBus as MissiveQueryBus, CommandBus as MissiveCommandBus } from 'missive.js';
import { FetchSpeakersWithTalksHandlerDefinition } from '../use-cases/fetch-speakers-with-talks.server';
import { LoadEventDetailsHandlerDefinition } from '../use-cases/load-event-details.server';

export type QueryDefitions = FetchSpeakersWithTalksHandlerDefinition & LoadEventDetailsHandlerDefinition;
export type QueryBus = MissiveQueryBus<QueryDefitions>;

export type CommandDefitions = any;
export type CommandBus = MissiveCommandBus<CommandDefitions>;

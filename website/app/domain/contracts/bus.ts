import { QueryBus as MissiveQueryBus, CommandBus as MissiveCommandBus } from 'missive.js';
export type QueryDefitions = any;
export type QueryBus = MissiveQueryBus<QueryDefitions>;

export type CommandDefitions = any;
export type CommandBus = MissiveCommandBus<CommandDefitions>;

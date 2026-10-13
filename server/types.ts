import type { Context } from 'hono';
import type { User } from '../shared/types';

export type AppEnv = {
  Variables: {
    user: User | null;
    sessionId: string | null;
    clientIp: string;
  };
};

export type AppContext = Context<AppEnv>;

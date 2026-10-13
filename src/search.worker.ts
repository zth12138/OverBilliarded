import { searchPlans } from './search';
import type { SearchRequest } from './types';
self.onmessage = (event: MessageEvent<SearchRequest>) => {
  try { searchPlans(event.data, update => self.postMessage(update)); }
  catch (error) { self.postMessage({ type: 'error', id: event.data.id, message: String(error) }); }
};

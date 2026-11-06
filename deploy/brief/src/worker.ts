import { type Env, handleRequest } from './routes'

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handleRequest(request, env),
}

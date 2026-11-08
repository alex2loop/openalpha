import { type Env, handleRequest } from './routes'

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> =>
    handleRequest(request, env, ctx),
}

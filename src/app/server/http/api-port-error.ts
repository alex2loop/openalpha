import { OperatorConfigError } from '@/core/config/resolve'

/** The API's port is taken: the operator's to fix, and no reason to stop the rest of the daemon. */
export class ApiPortInUseError extends OperatorConfigError {}

import { OperatorConfigError } from '@/core/config/operator-errors'

/** The API's port is taken: the operator's to fix, and no reason to stop the rest of the daemon. */
export class ApiPortInUseError extends OperatorConfigError {}

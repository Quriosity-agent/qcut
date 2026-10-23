export interface PendingBodyFrame {
	pid: number;
	id: string;
	frame: number;
	startedAt: number;
	outerRequestId?: string;
	association: "transport-id" | "unavailable" | "invalid-transport-id";
	report?: string;
	sequence?: {
		session: string;
		frame: number;
		timestamp?: number;
		checkpoints: string;
		executionProfile?: string;
		executionGeneration?: string;
	};
	completedAt?: number;
	elapsedMs?: number;
	outcome?: "ok" | "gap" | "error" | "exit";
	restartFrom?: number;
	error?: string;
}

export interface SequenceIpcRequest {
	requestId: string;
	frame: number;
	clip: string;
	fps: number;
	sourceTimestampSeconds?: number;
	replay: boolean;
	profile?: string;
	values?: Record<string, number>;
	enteredAt: number;
	completedAt?: number;
	elapsedMs?: number;
	status: "pending" | "completed" | "rejected";
	sessions: string[];
	workerRequestIds: string[];
	result?: { status?: string; cached?: boolean; from?: number };
	error?: string;
}

export interface CancelObservation {
	requestId: string;
	enteredAt: number;
	sequenceRequest?: SequenceIpcRequest;
	activeSequenceRequests: SequenceIpcRequest[];
	pending: PendingBodyFrame[];
	cancelled?: boolean;
}

export interface WorkerObservation {
	pending: PendingBodyFrame[];
	workerHistory: PendingBodyFrame[];
	completed: number;
	spawned: number[];
	exited: number[];
	sequenceRequests: SequenceIpcRequest[];
	sequenceHistory: SequenceIpcRequest[];
	cancellations: CancelObservation[];
	evidenceErrors: string[];
	executions: Array<{
		pid: number;
		frame: number;
		outerRequestId?: string;
		workerRequestId: string;
		sequence: PendingBodyFrame["sequence"];
		receivedAt: number;
		file: string;
		sha256: string;
		profile?: string;
		generation?: string;
		routes: Array<{ network: string; backend: string }>;
	}>;
	resumptions: Array<{
		pid: number;
		frame: number;
		outerRequestId?: string;
		workerRequestId: string;
		resumed: string;
		receivedAt: number;
	}>;
}

export interface ObserverGlobal {
	__bodyWorkerObservation?: WorkerObservation;
}

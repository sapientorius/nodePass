export type BackupOrigin = "manual" | "automatic" | "safety" | "existing";
export interface BackupSummary {
  name: string;
  createdAt: number;
  size: number;
  origin: BackupOrigin;
  inUse: boolean;
}
export interface BackupScheduleInput {
  enabled: boolean;
  days: number;
  time: string;
  timezone: string;
  keep: number;
}
export interface BackupSchedule extends BackupScheduleInput {
  configured: boolean;
  nextAt: number | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  error: BackupError | null;
}
export type BackupError =
  | "invalid"
  | "unavailable"
  | "verification"
  | "drain"
  | "rolledBack"
  | "recovery";
export type BackupJobState = "running" | "complete" | "failed";
export interface BackupJob {
  id: string;
  state: BackupJobState;
  step: string;
  name?: string;
  error?: BackupError;
}
export interface RestoreStatus {
  id: string;
  state: "upload" | "checking" | "ready" | "running" | "complete" | "failed";
  step: string;
  offset: number;
  uploadComplete?: boolean;
  createdAt?: number;
  counts?: Record<string, number>;
  database: string;
  confirmation: string;
  error?: BackupError;
}
export interface RestoreTicket extends RestoreStatus {
  statusToken: string;
}

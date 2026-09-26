export interface NicknameWithLine {
  nickname: string;
  line?: number; // Optional line value
  rakeback?: number; // Optional rakeback in percent (30 = 30%)
  owner?: boolean; // Whether the player is an owner
}

export interface AppState {
  file: File | null;
  workbook: any | null; // XLSX.WorkBook
  isProcessing: boolean;
  isFiltered: boolean;
  nicknames: NicknameWithLine[];
}

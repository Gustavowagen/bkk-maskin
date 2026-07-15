export interface NicknameWithLine {
  nickname: string;
  line?: number; // Optional line value
}

export type Club = 'knekt' | 'stvg';

export interface PlayerStack {
  nickname: string;
  chips: number;
}

export interface AppState {
  file: File | null;
  workbook: any | null; // XLSX.WorkBook
  isProcessing: boolean;
  isFiltered: boolean;
  nicknames: NicknameWithLine[];
}

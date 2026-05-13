export type Speaker = "JUDGE" | "WITNESS" | "LAWYER 1" | "LAWYER 2" | "CLERK";

export type LogItem = {
  id: string;
  at: number;
  speaker: Speaker;
  text: string;
  kind: "speech" | "mark";
};

export type AIScene = {
  id: string;
  title: string;
  startAt: number;
  endAt: number;
  speakers: Speaker[];
  lineIds: string[];
  snippet: string;
};

export type LawyerProfile = {
  fullName: string;
  barNumber: string;
  firm: string;
  role: "LAWYER 1" | "LAWYER 2";
  validThrough: string; // YYYY-MM-DD
  verifiedAt: number;
};

import type { NoteColor } from "@/features/home/schemas/note";

export type UserNote = {
  id: string;
  title: string | null;
  content: string;
  color: NoteColor;
  updatedAt: string;
};

export type HomeNotes = {
  quick: { content: string; updatedAt: string | null };
  stickies: UserNote[];
};

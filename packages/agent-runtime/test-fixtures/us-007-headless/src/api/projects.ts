export type ProjectResponse = {
  id: number;
  title: string;
};

export function projectResponse(id: number, title: string): ProjectResponse {
  return { id, title };
}

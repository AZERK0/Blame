export type TimeWindow = {
  end: number;
  start: number;
};

export function windowsOverlap(left: TimeWindow, right: TimeWindow) {
  return left.start <= right.end && right.start <= left.end;
}

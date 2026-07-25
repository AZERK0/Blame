import * as React from "react"

export function useLatestCallback<Arguments extends unknown[], Result>(
  callback: (...arguments_: Arguments) => Result
) {
  const callbackRef = React.useRef(callback)
  React.useLayoutEffect(() => {
    callbackRef.current = callback
  }, [callback])
  return React.useCallback(
    (...arguments_: Arguments) => callbackRef.current(...arguments_),
    []
  )
}

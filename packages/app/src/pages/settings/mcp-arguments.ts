type ArgumentParserState = {
  argumentsList: string[]
  argumentStarted: boolean
  currentArgument: string
  quote?: '"' | "'"
}

export function parseArguments(value: string) {
  const state: ArgumentParserState = {
    argumentsList: [],
    argumentStarted: false,
    currentArgument: "",
  }
  for (let index = 0; index < value.length; index += 1) {
    index = consumeCharacter(state, value, index)
  }
  if (state.quote) throw new Error("Close the quoted MCP argument")
  finishArgument(state)
  return state.argumentsList
}

export function formatArguments(argumentsList: string[]) {
  return argumentsList.map(formatArgument).join(" ")
}

function formatArgument(value: string) {
  if (value && !/[\s'"\\]/.test(value)) return value
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function consumeCharacter(
  state: ArgumentParserState,
  value: string,
  index: number
) {
  const character = value[index]
  const nextCharacter = value[index + 1]
  if (isEscapedCharacter(character, nextCharacter, state.quote)) {
    appendCharacter(state, nextCharacter)
    return index + 1
  }
  if (state.quote && character === state.quote) state.quote = undefined
  else if (!state.quote && (character === '"' || character === "'")) {
    state.quote = character
    state.argumentStarted = true
  } else if (!state.quote && character && /\s/.test(character)) {
    finishArgument(state)
  } else if (character) appendCharacter(state, character)
  return index
}

function isEscapedCharacter(
  character: string | undefined,
  nextCharacter: string | undefined,
  quote: '"' | "'" | undefined
) {
  return (
    character === "\\" &&
    Boolean(nextCharacter) &&
    quote !== "'" &&
    /[\s'"\\]/.test(nextCharacter ?? "")
  )
}

function appendCharacter(state: ArgumentParserState, character: string) {
  state.currentArgument += character
  state.argumentStarted = true
}

function finishArgument(state: ArgumentParserState) {
  if (state.argumentStarted) state.argumentsList.push(state.currentArgument)
  state.currentArgument = ""
  state.argumentStarted = false
}

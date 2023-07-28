type Cookie = {
    [key: string]: string | undefined
}

type Response = {
  write: () => any;
  end: Function;
}

export const parseSetCookie = (header:string) => {
  let match
  const pairs:Cookie[] = []
  const pattern = /\s*([^=;]+)(?:=([^;]*);?|;|$)/g

  while ((match = pattern.exec(header))) {
    pairs.push({ name: match[1], value: match[2] })
  }

  const cookie:Cookie = pairs.shift() as Cookie

  for (let i = 0; i < pairs.length; i++) {
    match = pairs[i]
    // @ts-ignore
    cookie[match.name.toLowerCase()] = (match.value || true)
  }

  return cookie
}

export function writePatch (res:any) {
  var _end = res.end
  var _write = res.write
  var ended = false

  res.end = function end () {
    ended = true
    return _end.apply(this, arguments)
  }

  res.write = function write () {
    if (ended) {
      throw new Error('write after end')
    }

    return _write.apply(this, arguments)
  }
}

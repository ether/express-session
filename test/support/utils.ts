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

export const  writePatch =(res: Response)=> {
  const _end = res.end
  const _write = res.write
  let ended = false

  res.end = () => {
    ended = true
    return _end.apply(this, res)
  }

  res.write = () => {
    if (ended) {
      throw new Error('write after end')
    }

    return _write.apply(this, [])
  }
}

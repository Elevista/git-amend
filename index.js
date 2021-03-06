#!/usr/bin/env node
const moment = require('moment')
const { MultiSelect, Select, Snippet, Form } = require('enquirer')
const { exec, execStdin, makeEcho, colors: c } = require('./util')
const format = 'ddd MMM DD HH:mm:ss YYYY Z'
const formatDispay = 'YYYY-MM-DD HH:mm'
let [,, limit] = process.argv
limit = +limit || 10
// %H: commit hash
// %h: abbreviated commit hash
// %an: author name
// %ae: author email
// %ad: author date
// %cn: committer name
// %ce: committer email
// %cd: committer date
// %s: subject
// %n: newline

const setEnv = function ({ name, email, date }) {
  return Object.assign(process.env, {
    'GIT_AUTHOR_NAME': name,
    'GIT_AUTHOR_EMAIL': email,
    'GIT_AUTHOR_DATE': date,
    'GIT_COMMITTER_NAME': name,
    'GIT_COMMITTER_EMAIL': email,
    'GIT_COMMITTER_DATE': date
  })
}
const itemDisplay = function ({ hs, date, name, subject, sequence }) {
  return `${c.yellow`(${hs})`} ${c.bold(date.format(formatDispay))} ${c.green.bold(name)} ${subject}${c.cyan(sequence)}`
}

;(async function () {
  if (exec`git status -s -uno`.length) {
    c.red.bold.println`You have uncommitted changes`
    return
  }
  try { exec`git rebase --abort` } catch (e) {}

  const stdout = exec`git log --format=${'%H%x00%h%x00%p%x00%an%x00%ae%x00%ad%x00%cn%x00%ce%x00%cd%x00%s%x00%b%x00%n'} -z -${limit + 1}`
  const ref = {}
  const commits = stdout.split('\x00\n\x00').map((log, idx) => {
    const [hash, hs, p, name, email, date, cname, cemail, cdate, subject, body] = log.trim().split('\x00')
    const parents = p ? p.split(' ') : []
    const isMerge = parents.length > 1
    return hash ? {
      hash,
      hs,
      parents,
      isMerge,
      subject,
      body,
      name,
      email,
      date: moment(date, format),
      cname,
      cemail,
      cdate: moment(cdate, format),
      idx,
      selected: false
    } : undefined
  }).filter(x => x)
  commits.forEach(x => { ref[x.hash] = x })

  const selectedCommits = (await new MultiSelect({
    name: 'value',
    message: 'Select commits to change',
    footer: 'Please select at least one',
    limit,
    validate (v) { return !!v.length },
    result (names) {
      return Object.values(this.map(names))
    },
    choices: commits.slice(0, -1).map(({ hash, hs, name, date, subject }) => ({
      name: `${c.yellow`(${hs})`} ${c.bold(date.format(formatDispay))}`,
      hint: `${c.green.bold(name)} ${subject}`,
      value: hash
    }))
  }).run()).map(x => ref[x])

  commits.reverse()
  selectedCommits.reverse()
  selectedCommits.forEach(x => { x.selected = true })
  const selectedCommitIdx = commits.findIndex(x => x.selected)
  if (selectedCommitIdx < 1) throw Error(`Can't rebase`)
  const rebaseIndex = selectedCommitIdx - (commits[selectedCommitIdx].isMerge ? 0 : 1)
  const rebaseTarget = commits[rebaseIndex]
  const rebaseCommits = commits.slice(rebaseIndex + 1).filter(x => !x.isMerge)

  const rebaseString = rebaseCommits.map(({ hs }) => `edit ${hs}`).join('\n')
  process.env['GIT_SEQUENCE_EDITOR'] = `${makeEcho(rebaseString)}>`

  const mode = {}
  const modeName = await new Select({
    name: 'mode',
    message: 'Select mode',
    choices: [
      { name: 'info', message: 'Edit info', hint: `- author,email,message` },
      { name: 'set', message: 'Set date', hint: `- change date individually` },
      { name: 'adjust', message: 'Adjust date', hint: `- add duration to all selected` },
      { name: 'stretch', message: 'Stretch Time', hint: '- change date to fit range' }
    ]
  }).run()
  mode[modeName] = true

  async function editInfo ({ subject, hs, name, email, date, cname, cemail, cdate, body }, sequence) {
    const message = itemDisplay({ hs, date, name, subject, sequence })
    body = body.replace(/\n/gm, '\\n')
    const to = await new Form({
      name: 'commit',
      message,
      choices: [
        { name: 'name', message: 'Name', initial: name },
        { name: 'email', message: 'Email', initial: email },
        { name: 'subject', message: 'Subject', initial: subject },
        { name: 'body', message: 'Body', initial: body }
      ]
    }).run()
    const diff = { name: name !== to.name, email: email !== to.email, message: subject !== to.subject || body !== to.body }
    to.body = to.body.replace(/\\n/g, '\n')
    return () => {
      setEnv(Object.assign(to, { date }))
      if (diff.name || diff.email) exec`git commit --amend --no-edit --author="${to.name} <${to.email}>"`
      if (diff.message) {
        execStdin(`git commit --amend --no-verify --no-edit --file=-`, `${to.subject}${to.body && (`\n\n${to.body}`)}`)
      }
      exec`git rebase --skip`
    }
  }
  async function askTime (message, date) {
    const fn = c.bold`moment` + (date ? '' : `.${c.yellow`duration`}`)
    const days = date ? 'date' : 'days'
    const template = `${fn}({
    seconds: ${c.yellow`\${seconds}`},
    minutes: ${c.yellow`\${minutes}`},
    hours: ${c.yellow`\${hours}`},
    ${days}: ${c.yellow`\${${days}}`},
    months: ${c.yellow`\${months}`},
    years: ${c.yellow`\${years}`}
  })`
    const values = date ? date.toObject() : {
      seconds: 0,
      minutes: 0,
      hours: 0,
      days: 0,
      months: 0,
      years: 0
    }
    Object.keys(values).forEach(key => { values[key] += '' })
    const validate = v => !isNaN(v)
    const fields = Object.keys(values).map(name => ({ name, validate }))

    const { values: ret } = await new Snippet({
      name: 'Time unit',
      message,
      fields,
      format () { return '' },
      values,
      template
    }).run()
    return ret
  }
  let timeUnit
  async function changeTime ({ subject, hs, name, email, date, cname, cemail }, sequence) {
    if (mode.set) timeUnit = await askTime(itemDisplay({ hs, date, name, subject, sequence }), date)
    else if (!timeUnit) timeUnit = await askTime('Duration to add')
    const m = mode.set ? moment(timeUnit) : date.add(timeUnit)
    const newDate = m.format(format)
    return () => {
      setEnv({ name, email, date: newDate })
      exec`git commit --amend --no-verify --no-edit --date="${newDate}" --author="${name} <${email}>"`
      exec`git rebase --skip`
    }
  }

  const stretchTime = (() => {
    const first = selectedCommits[0].date
    const last = selectedCommits[selectedCommits.length - 1].date
    let adjust
    return async (commit) => {
      if (!adjust) {
        const from = moment(await askTime('Stretch from', first))
        const to = moment(await askTime('Stretch to', last))
        const diff = (to - from)
        adjust = date => {
          const ratio = ((date - first) / (last - first)) || 0
          return from + (diff * ratio)
        }
      }
      return () => {
        const { name, email } = commit
        const date = moment(adjust(commit.date)).format(format)
        setEnv({ name, email, date })
        exec`git commit --amend --no-verify --no-edit --date="${date}" --author="${name} <${email}>"`
        exec`git rebase --skip`
      }
    }
  })()

  const q = [() => exec`git rebase -i ${rebaseTarget.hash}`]
  const { length: selectedCount } = rebaseCommits.filter(x => x.selected)
  for (let i = 0, count = 0; i < rebaseCommits.length; i++) {
    const commit = rebaseCommits[i]
    if (commit.selected) {
      const sequence = `(${++count}/${selectedCount})`
      q.push(() => c.println`running.. ${c.cyan(sequence)}`)
      if (mode.stretch) q.push(await stretchTime(commit))
      else if (mode.info) q.push(await editInfo(commit, sequence))
      else q.push(await (changeTime)(commit, sequence))
    } else {
      q.push(() => {
        setEnv(commit)
        exec`git commit --amend --no-edit`
        exec`git rebase --skip`
      })
    }
  }
  try {
    q.forEach(x => x())
  } catch (e) {
    exec`git rebase --abort`
    throw e
  }
  c.yellow.bold.println`Done!`
})().catch(e => {
  c.red.bold.println(e.toString())
})

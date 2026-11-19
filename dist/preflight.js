// Command preflight (check.preflight): the first word of every step a run will execute must be a shell builtin, a path to an
// executable file, or found on PATH, so a typo or a missing tool refuses the run before any judge or agent call instead of
// printing "command not found" from the shell after the run started.
import { resolve } from 'node:path';
import { isExecutable, onPath } from './judge.js';
const BUILTINS = new Set([':', '.', '[', '[[', 'alias', 'bg', 'break', 'builtin', 'cd', 'command', 'continue', 'declare', 'dirs', 'echo', 'eval', 'exec', 'exit', 'export', 'false', 'fg', 'getopts', 'hash', 'jobs', 'kill', 'let', 'local', 'popd', 'printf', 'pushd', 'pwd', 'read', 'readonly', 'return', 'set', 'shift', 'source', 'test', 'times', 'trap', 'true', 'type', 'typeset', 'ulimit', 'umask', 'unalias', 'unset', 'wait']);
// Words that open or close a compound command: the step goes on after them.
const KEYWORDS = new Set(['!', '{', '}', 'if', 'then', 'else', 'elif', 'fi', 'while', 'until', 'do', 'done', 'esac', 'time']);
// Steps that hold no command of their own to check (their header words are loop variables and lists).
const HEADERS = new Set(['for', 'select']);
const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh']);
// Wrappers that run the rest of the step; builtins among them need no PATH lookup of their own.
const WRAPPERS = new Set(['env', 'exec', 'command', 'builtin', 'nohup', 'nice', 'timeout']);
// The steps of a shell command, split on && || ; | & and newlines outside quotes, each a list of words with redirections dropped.
// null when the text uses a construct whose commands cannot be read without running it (a here-document, a function, a case).
function steps(command) {
    const out = [[]];
    let word = null;
    let dropNext = false;
    const endWord = () => {
        if (!word)
            return;
        if (/^(&|\d*)[<>]/.test(word.text) && !word.dynamic)
            dropNext = /^(&|\d*)(>>?|<)$/.test(word.text);
        else if (dropNext)
            dropNext = false;
        else
            out[out.length - 1].push(word);
        word = null;
    };
    const endStep = () => {
        endWord();
        dropNext = false;
        if (out[out.length - 1].length)
            out.push([]);
    };
    for (let i = 0; i < command.length; i++) {
        const c = command[i];
        if (c === '\\') {
            word ??= { text: '', dynamic: false };
            word.text += command[++i] ?? '';
            continue;
        }
        if (c === "'" || c === '"') {
            word ??= { text: '', dynamic: false };
            const close = c;
            for (i++; i < command.length && command[i] !== close; i++) {
                if (close === '"' && command[i] === '\\')
                    i++;
                else if (close === '"' && (command[i] === '$' || command[i] === '`'))
                    word.dynamic = true;
                word.text += command[i] ?? '';
            }
            continue;
        }
        if (c === '#' && !word) {
            while (i < command.length && command[i] !== '\n')
                i++;
            i--;
            continue;
        }
        if (c === '<' && command[i + 1] === '<')
            return null;
        if (c === '(' && command[i + 1] === ')')
            return null;
        if (/\s/.test(c) && c !== '\n') {
            endWord();
            continue;
        }
        if (c === '\n' || c === ';' || c === '(' || c === ')') {
            endStep();
            continue;
        }
        if (c === '&' && (command[i + 1] === '&' || word === null || !/[<>]$/.test(word.text))) {
            if (command[i + 1] === '&')
                i++;
            endStep();
            continue;
        }
        if (c === '|') {
            if (command[i + 1] === '|')
                i++;
            endStep();
            continue;
        }
        word ??= { text: '', dynamic: false };
        if (c === '$' || c === '`' || c === '*' || c === '?' || c === '[')
            word.dynamic = true;
        word.text += c;
    }
    endStep();
    const all = out.filter((s) => s.length);
    return all.some((s) => ['function', 'case'].includes(s[0].text)) ? null : all;
}
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
// The word that is not a command, or null when every step starts with one. cwd resolves a relative path; a cd earlier in the
// command moves it, so a relative path after one is left to the shell.
export function missingCommand(command, cwd) {
    const parsed = steps(command);
    if (!parsed)
        return null;
    let moved = false;
    const check = (words) => {
        let i = 0;
        while (i < words.length && (KEYWORDS.has(words[i].text) || ASSIGNMENT.test(words[i].text))) {
            if (/^PATH=/.test(words[i].text))
                return null;
            i++;
        }
        const w = words[i];
        if (!w || w.dynamic || HEADERS.has(w.text) || w.text.startsWith('~'))
            return null;
        const rest = words.slice(i + 1);
        const name = w.text;
        if (name === 'cd' || name === 'pushd')
            moved = true;
        const found = BUILTINS.has(name) || (name.includes('/') ? (moved && !name.startsWith('/')) || isExecutable(resolve(cwd, name)) : !!onPath(name));
        if (!found)
            return name;
        if (WRAPPERS.has(name)) {
            // Options (and VAR=value for env) come first, timeout then takes its duration; the command follows.
            let j = 0;
            while (j < rest.length && (rest[j].text.startsWith('-') || (name === 'env' && ASSIGNMENT.test(rest[j].text))))
                j++;
            if (name === 'timeout')
                j++;
            return rest[j] ? check(rest.slice(j)) : null;
        }
        if (SHELLS.has(name)) {
            const flag = rest.findIndex((r) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(r.text));
            const script = flag >= 0 ? rest[flag + 1] : undefined;
            return script && !script.dynamic ? missingCommand(script.text, cwd) : null;
        }
        return null;
    };
    for (const step of parsed) {
        const bad = check(step);
        if (bad)
            return bad;
    }
    return null;
}
// The refusal line for the first command a run would execute that is not found, or null. entries: each journey, suite or live
// check by its label, with the shell command it runs.
export function preflightFault(entries, cwd) {
    for (const { label, command } of entries) {
        const word = missingCommand(command, cwd);
        if (word)
            return `command not found: ${word} in ${label}`;
    }
    return null;
}

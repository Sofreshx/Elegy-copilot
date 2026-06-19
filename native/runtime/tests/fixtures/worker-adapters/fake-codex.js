const args = process.argv.slice(2);
const resumed = args[0] === 'resume';
console.log(JSON.stringify({
  type: 'thread.started',
  thread_id: resumed ? args[1] : 'thread-1',
}));
console.log(JSON.stringify({ type: 'turn.started' }));
console.log(JSON.stringify({
  type: 'turn.completed',
  message: resumed ? 'resumed' : 'completed',
}));

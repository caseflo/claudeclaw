/**
 * schedule-cli.ts — task CRUD from the command line
 * Usage: tsx src/schedule-cli.ts <command> [args...]
 *
 * Commands:
 *   create <name> <prompt> <cron> <chat_id> [agent_id] [priority]
 *   list
 *   delete <task_id>
 *   pause <task_id>
 *   resume <task_id>
 */
import { createTask, getAllTasks, deleteTask, setTaskStatus } from './db.js';
import { computeNextRun } from './scheduler.js';

const [,, command, ...args] = process.argv;

switch (command) {
  case 'create': {
    const [name, prompt, cron, chatId, agentId = 'main', priorityStr = '3'] = args;
    if (!name || !prompt || !cron || !chatId) {
      console.error('Usage: create <name> <prompt> <cron> <chat_id> [agent_id] [priority]');
      process.exit(1);
    }
    const nextRun = computeNextRun(cron);
    const id = createTask({ name, prompt, cron, chat_id: chatId, agent_id: agentId, priority: parseInt(priorityStr), status: 'pending', next_run: nextRun ?? undefined });
    console.log(`Task created: ${id}`);
    console.log(`Next run: ${nextRun ?? 'Invalid cron'}`);
    break;
  }

  case 'list': {
    const tasks = getAllTasks();
    if (tasks.length === 0) { console.log('No tasks.'); break; }
    for (const t of tasks) {
      console.log(`[${t.id.slice(0, 8)}] ${t.name} (${t.agent_id}) — ${t.status}`);
      console.log(`  Cron: ${t.cron} | Next: ${t.next_run ?? 'none'} | Runs: ${t.run_count}`);
    }
    break;
  }

  case 'delete': {
    const [id] = args;
    if (!id) { console.error('Usage: delete <task_id>'); process.exit(1); }
    deleteTask(id);
    console.log('Deleted.');
    break;
  }

  case 'pause': {
    const [id] = args;
    if (!id) { console.error('Usage: pause <task_id>'); process.exit(1); }
    setTaskStatus(id, 'paused');
    console.log('Paused.');
    break;
  }

  case 'resume': {
    const [id] = args;
    if (!id) { console.error('Usage: resume <task_id>'); process.exit(1); }
    setTaskStatus(id, 'pending');
    console.log('Resumed.');
    break;
  }

  default:
    console.log('Commands: create | list | delete | pause | resume');
}

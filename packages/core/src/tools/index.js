import exec_command from './exec_command.js';
import read_file from './read_file.js';
import write_file from './write_file.js';
import edit_file from './edit_file.js';
import schedule from './schedule.js';
import ask_user_question from './ask_user_question.js';

export const TOOLS = [exec_command, read_file, write_file, edit_file, schedule, ask_user_question];
export const toolByName = (n) => TOOLS.find((t) => t.name === n);

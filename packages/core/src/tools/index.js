import exec_command from './exec_command.js';
import read_file from './read_file.js';
import write_file from './write_file.js';
import edit_file from './edit_file.js';
import schedule from './schedule.js';
import ask_user_question from './ask_user_question.js';
import web_search from './web_search.js';
import fetch_website from './fetch_website.js';
import view_screen from './view_screen.js';
import computer from './computer.js';

export const TOOLS = [exec_command, read_file, write_file, edit_file, schedule, ask_user_question, web_search, fetch_website, view_screen, computer];
export const toolByName = (n) => TOOLS.find((t) => t.name === n);

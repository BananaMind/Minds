import { render } from 'preact';
import { App } from './App.jsx';
import { MobileRoot, isMobile } from './mobile.jsx';
import './styles.css';

render(isMobile() ? <MobileRoot /> : <App />, document.getElementById('app'));

import React, { Component } from 'react';
import './App.css';
import createHistory from 'history/createBrowserHistory';

import Button from 'antd/lib/button';
import Select from 'antd/lib/select';
import queryString from 'query-string';

import TAComplete from './TAComplete';
import TATreeViewer from './TATreeViewer';
import TADetailViewer from './TADetailViewer';
import SplitPane from 'react-split-pane';
const Option = Select.Option;

let conzept_language = getParameterByName( 'l' ) || 'en';
let default_interface_language = 'la';

if ( conzept_language === 'en' ){
  default_interface_language = 'en';
}

function LanguageSelect(props) {
  return (<Select style={{ width: 95 }}
    defaultValue={default_interface_language}
    {...props}>
    <Option value="la">Latin</Option>
    <Option value="en">English</Option>
  </Select>
  )
}

function stripHtml( s ) {

  if ( typeof s === undefined || typeof s === 'undefined' ){
  }
  else {

    return s.replace(/<\/?("[^"]*"|'[^']*'|[^>])*(>|$)/g, "") || '';

  }

}

function getParameterByName( name, url ) {

  if ( !url ){
    url = window.location.href;
  }

  const regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)");
  const results = regex.exec( url );

  if (!results) return undefined;
  if (!results[2]) return '';

  return stripHtml( decodeURIComponent(results[2].replace(/\+/g, " ")) );

}

function About() {

  return ( <span></span> );

  /*
  return (<Button
    href="https://mhalle.github.io/taviewer"
    size="default"
    target="_blank">about...</Button>
  )
  */

}

class App extends Component {
  history = null;
  unlisten = null;

  state = {
    selectExpandNode: null,
    lightboxIsOpen: false,
    currentImage: 0,
    language: default_interface_language,
    conzept_language: conzept_language,
  };

  constructor() {
    super();
    this.history = createHistory();
    this.unlisten = this.history.listen((location, action) => {
      this.handleHistory(location, action);
    });
  }

  handleSelectExpandNode = (n) => {
    this.setState({
      selectExpandNode: n,
      lightboxIsOpen: false
    });
    this.pushHistory(n);
  }

  pushHistory = (n, lightboxOn) => {
    const uri = n ? `/app/taviewer/?l=${conzept_language}&id=${n.id}` : `/app/taviewer?l=${conzept_language}`;
    const historyState = lightboxOn ? { lb: 1 } : undefined;

    this.history.push(uri, historyState);
  }

  openLightbox = () => {
    this.setState({ lightboxIsOpen: true });
  }

  closeLightbox = () => {
    this.setState({ lightboxIsOpen: false });
  }

  handleHistory = (location, action) => {
    if (action === 'POP' || action === 'X-INIT') {
      if (this.state.lightboxIsOpen) {
        this.pushHistory(this.state.selectExpandNode);
        this.setState({
          lightboxIsOpen: false
        });
        return;
      }

      const query = queryString.parse(location.search);
      let selectedNode = null;
      if (query.id && this.props.ta98Data.getNodeById(query.id)) {
        selectedNode = this.props.ta98Data.getNodeById(query.id);
      }
      this.setState({
        lightboxIsOpen: false,
        selectExpandNode: selectedNode
      });
    }
  }

  componentDidMount() {
    this.handleHistory(this.history.location, 'X-INIT');
  }

  componentWillUnmount() {
    if (this.state.unlisten) {
      this.state.unlisten();
    }
  }

  changeLanguage = (language) => {
    this.setState({
      language
    })
  }

  render() {
    return (

      <div className="taviewer">
        <header className="taviewer-header">
          <div className="taviewer-menubar">
          <div className="taviewer-title">
            <h2>tree view</h2>
          </div>
            <div className="taviewer-search">
              <TAComplete language={this.state.language}
                className="taviewer-complete"
                data={this.props.ta98Data}
                onSelect={this.handleSelectExpandNode} />
            </div>
            <LanguageSelect onChange={this.changeLanguage} />
            <About />
          </div>
        </header>
        <main className="taviewer-main">
          <div className="taviewer-tree">
            <TATreeViewer language={this.state.language}
              data={this.props.ta98Data}
              conzept_language={this.state.conzept_language}
              onSelect={this.handleSelectExpandNode}
              selectExpandNode={this.state.selectExpandNode} />
          </div>
          <div className="taviewer-detail">
            <TADetailViewer language={this.state.language}
              openLightbox={this.openLightbox}
              closeLightbox={this.closeLightbox}
              lightboxIsOpen={this.state.lightboxIsOpen}
              selectExpandNode={this.handleSelectExpandNode}
              node={this.state.selectExpandNode} />
          </div>
        </main>
      </div>
    );
  }

}

export default App;

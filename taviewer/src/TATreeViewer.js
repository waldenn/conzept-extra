import _ from 'lodash';
import React, { Component } from 'react';
import Tree from 'antd/lib/tree';
const TreeNode = Tree.TreeNode;

let conzept_language = getParameterByName( 'l' ) || 'en';

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

class TATreeViewer extends Component {
    state = {
        expandedKeys: [],
        searchValue: '',
        autoExpandParent: true,
        selectedKeys: []
    }
    componentDidMount() {
        this.selectExpandNode(this.props.selectExpandNode);
    }

    selectExpandNode( node) {

      //console.log( node );

      let keyValue = node ? [node.id] : [];
      let title = node ? [node.name.en][0] : '';
      let qid = node ? [node.wikiDataId[0]][0] : '';

      if ( typeof title === undefined || typeof title === 'undefined' || title === 'undefined' ){

        title = '';

      }

      if ( typeof qid === undefined || typeof qid === 'undefined' || qid === 'undefined' ){

        qid = '';

      }

      this.setState({
          expandedKeys: keyValue,
          autoExpandParent: true,
          selectedKeys: keyValue
      })

      //console.log( 'selectExpandNode: ', node );
      console.log( title, qid, conzept_language );

      let url = '/app/wikipedia/?t=' + title + '&l=' + conzept_language + '&qid=' + qid ;
      window.parent.postMessage({ event_id: 'handleClick', data: { type: 'link', title: title, url: url, current_pane: window.getCurrentPane(), target_pane: 'ps2' } }, '*' );

      //window.parent.postMessage({ event_id: 'handleClick', data: { type: 'wikipedia-side', title: title, hash: '', language: conzept_language, qid: qid } }, '*' );

    }

    componentWillReceiveProps(nextProps) {
        let newNode = nextProps.selectExpandNode;

        if (newNode !== this.props.selectExpandNode) {
            this.selectExpandNode(newNode);
        }
    }

    onExpand = (e) => {
        this.setState({
            expandedKeys: e,
            autoExpandParent: false
        })

      //console.log( 'onExpand: ', e );

    }

    onSelect = (keys, ev) => {

        if (keys && keys.length === 1 && this.props.onSelect) {
            this.props.onSelect(this.props.data.getNodeById(keys[0]));
        }
        this.setState({ selectedKeys: keys });

        //console.log( 'onSelect: ', keys, ev, ev.node.props.title );

    }
    render() {
        const { expandedKeys, autoExpandParent, selectedKeys } = this.state;
        const language = this.props.language;
        return (
            <Tree showLine
                onExpand={this.onExpand}
                expandedKeys={expandedKeys}
                autoExpandParent={autoExpandParent}
                selectedKeys={selectedKeys}
                onSelect={this.onSelect}
            >
                {tree_level(this.props.data.tree, language)}
            </Tree>
        );
    }
}

function tree_level(node_list, language) {
    if (!node_list) {
        return;
    }
    let sorted_list = _.sortBy(node_list, x => x.id);
    return (_.map(sorted_list, node => {
        let title_label = `${node.name[language]} (${node.id})`;
        return (
            <TreeNode
                className={node.children ? "taviewer-group" : "taviewer-leaf"}
                title={title_label}
                key={node.id}>
                {tree_level(node.children, language)}
            </TreeNode>
        );
    }));
}

export default TATreeViewer;

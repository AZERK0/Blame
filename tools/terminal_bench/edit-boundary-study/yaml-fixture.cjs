const assert=require('node:assert/strict');
const YAML=require('../dist');
const cases=[
 ['scalar','key: &plain value\n','key','&plain'],
 ['sequence','key: &seq [1,2]\n','key','&seq'],
 ['map','key: &map {x: 1}\n','key','&map'],
 ['block-sequence','key: &seq\n  - 1\n','key','&seq'],
 ['block-map','key: &map\n  x: 1\n','key','&map'],
 ['empty','key: &empty\nother: 2\n','key','&empty'],
 ['tagged','key: !!str &tag value\n','key','&tag'],
 ['unicode-crlf','emoji: 😀\r\nkey: &é value\r\n','key','&é'],
 ['comment-anchor-decoy','# &same decoy\nkey: &same value\n','key','&same']
];
module.exports=function register(test){
 for(const [name,source,key,anchor]of cases)test(name,()=>{
  const doc=YAML.parseDocument(source);assert.deepEqual(doc.errors,[]);
  const node=doc.get(key,true),start=source.lastIndexOf(anchor);
  assert.equal(node.anchor,anchor.slice(1));assert.deepEqual(node.anchorRange,[start,start+anchor.length]);
  assert.equal(source.slice(...node.anchorRange),anchor);
  assert.deepEqual(doc.toJS(),YAML.parse(doc.toString()));
 });
 test('aliases and unanchored/programmatic nodes stay unannotated',()=>{
  const doc=YAML.parseDocument('a: &same value\nb: *same\nc: other\n');
  assert.equal(Object.hasOwn(doc.get('b',true),'anchorRange'),false);
  assert.equal(Object.hasOwn(doc.get('c',true),'anchorRange'),false);
  const scalar=new YAML.Scalar('x');scalar.anchor='manual';
  assert.equal(Object.hasOwn(scalar,'anchorRange'),false);
  assert.equal(doc.get('b',true).source,'same');assert.equal(doc.toJS().b,'value');
 });
 test('clone copies the range tuple',()=>{
  const doc=YAML.parseDocument('a: &one value\n'),node=doc.get('a',true),copy=node.clone();
  assert.deepEqual(copy.anchorRange,node.anchorRange);assert.notEqual(copy.anchorRange,node.anchorRange);
  copy.anchorRange[0]++;assert.equal(node.anchorRange[0],3);
 });
 test('keepSourceTokens does not control anchor positions',()=>{
  for(const keepSourceTokens of [false,true]){
   const doc=YAML.parseDocument('a: &one value\n',{keepSourceTokens});
   assert.deepEqual(doc.get('a',true).anchorRange,[3,7]);
  }
 });
};

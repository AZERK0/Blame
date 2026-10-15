// Public task fixtures. Private probes use independent values and extra hook cases.
const assert = require('node:assert/strict');
module.exports = function evaluate(api, kind, test) {
  const { Command, Option, Argument, Help, InvalidArgumentError } = api;
  const quiet = () => new Command().exitOverride().configureOutput({writeOut(){},writeErr(){}});
  if (kind === 'choices') {
    test('both choice APIs opt in, return the first canonical spelling and copy input', () => {
      for (const make of [()=>new Option('--color <value>'),()=>new Argument('<color>')]) {
        const values = ['Red','BLUE','red']; const target=make();
        assert.equal(target.choices(values,{caseInsensitive:true}),target);
        values[0]='changed'; assert.equal(target.parseArg('rEd'), 'Red');
        assert.equal(target.parseArg('blue'), 'BLUE');
        assert.throws(()=>target.parseArg('missing'),e=>e instanceof InvalidArgumentError);
        assert.deepEqual(target.argChoices,['Red','BLUE','red']);
      }
    });
    test('absent and non-true flags retain case-sensitive choices', () => {
      for (const config of [undefined,null,{}, {caseInsensitive:false},{caseInsensitive:1}])
        for (const target of [new Option('--color <value>'),new Argument('<color>')]) {
          target.choices(['Red'],config); assert.equal(target.parseArg('Red'),'Red');
          assert.throws(()=>target.parseArg('red'),e=>e instanceof InvalidArgumentError);
        }
    });
    test('variadic choices accumulate canonical values without changing defaults', () => {
      for (const target of [new Option('--color <value...>'),new Argument('<color...>')]) {
        const defaults=['old']; target.default(defaults).choices(['Red','Blue'],{caseInsensitive:true});
        const first=target.parseArg('RED',defaults); assert.deepEqual(first,['Red']);
        assert.deepEqual(target.parseArg('blue',first),['Red','Blue']); assert.deepEqual(defaults,['old']);
      }
    });
    test('real command parsing and help expose canonical choices', () => {
      const command=quiet().addOption(new Option('--color <value>').choices(['Red'],{caseInsensitive:true}))
        .addArgument(new Argument('<shape>','shape description').choices(['Circle'],{caseInsensitive:true}));
      command.parse(['--color','RED','circle'],{from:'user'});
      assert.equal(command.opts().color,'Red'); assert.deepEqual(command.processedArgs,['Circle']);
      assert.match(command.helpInformation(),/Red/); assert.match(command.helpInformation(),/Circle/);
    });
  } else if (kind === 'hidden-arguments') {
    test('hideHelp is fluent and reversible, with a public hidden boolean', () => {
      const arg=new Argument('<secret>','private detail'); assert.equal(arg.hidden,false);
      assert.equal(arg.hideHelp(),arg); assert.equal(arg.hidden,true);
      assert.equal(arg.hideHelp(false),arg); assert.equal(arg.hidden,false);
    });
    test('hidden descriptions disappear, while usage and parsing remain unchanged', () => {
      const secret=new Argument('<secret>','private detail').hideHelp();
      const publicArg=new Argument('[file]','public detail');
      const command=quiet().addArgument(secret).addArgument(publicArg),helper=new Help();
      assert.deepEqual(helper.visibleArguments(command),[publicArg]);
      const help=command.helpInformation(); assert(!help.includes('private detail'));
      assert(help.includes('public detail')); assert(help.includes('<secret>'));
      command.parse(['token','file.txt'],{from:'user'}); assert.deepEqual(command.processedArgs,['token','file.txt']);
      assert.throws(()=>quiet().addArgument(new Argument('<secret>').hideHelp()).parse([],{from:'user'}),e=>e.code==='commander.missingArgument');
    });
    test('only visible descriptions enable the argument table', () => {
      const command=quiet().addArgument(new Argument('<secret>','hidden description').hideHelp()).addArgument(new Argument('[plain]'));
      assert.deepEqual(new Help().visibleArguments(command),[]);
      command.registeredArguments[0].hideHelp(false);
      assert.deepEqual(new Help().visibleArguments(command),command.registeredArguments);
    });
    test('legacy descriptions still apply without unhiding an argument or mutating the registry', () => {
      const command=quiet().argument('<secret>').argument('[file]');
      command.registeredArguments[0].hideHelp(); command.description('',{secret:'legacy secret',file:'legacy file'});
      const registry=command.registeredArguments.slice();
      assert.deepEqual(new Help().visibleArguments(command),[registry[1]]);
      assert.equal(registry[0].description,'legacy secret'); assert.deepEqual(command.registeredArguments,registry);
    });
  } else if (kind === 'env-fallback') {
    const keys=['BLAME_F30_PRIMARY','BLAME_F30_BACKUP','BLAME_F30_LAST'];
    const withEnv=(values,run)=>{const saved=keys.map(k=>process.env[k]);try{keys.forEach((k,i)=>values[i]===undefined?delete process.env[k]:process.env[k]=values[i]);return run();}finally{keys.forEach((k,i)=>saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i]);}};
    const option=()=>new Option('--color <value>').env(keys[0],[keys[1],keys[2]]);
    test('ordered fallbacks select the first defined value, including empty strings',()=>{
      for(const [values,expected] of [[[undefined,'blue','red'],'blue'],[['','blue','red'],''],[['green','blue','red'],'green'],[[undefined,undefined,'red'],'red']])
        withEnv(values,()=>{const c=quiet().addOption(option());c.parse([],{from:'user'});assert.equal(c.opts().color,expected);assert.equal(c.getOptionValueSource('color'),'env');});
    });
    test('CLI and client values win, defaults/config lose and the parser runs once',()=>withEnv([undefined,'blue','red'],()=>{
      let calls=0;const parser=v=>{calls++;return v.toUpperCase();};
      const c=quiet().addOption(option().argParser(parser).default('default'));c.parse(['--color','cli'],{from:'user'});
      assert.equal(c.opts().color,'CLI');assert.equal(calls,1);
      const client=quiet().addOption(option().argParser(parser));client.setOptionValue('color','client');client.parse([],{from:'user'});assert.equal(client.opts().color,'client');assert.equal(calls,1);
      const config=quiet().addOption(option().argParser(parser));config.setOptionValueWithSource('color','config','config');config.parse([],{from:'user'});assert.equal(config.opts().color,'BLUE');assert.equal(calls,2);
    }));
    test('error messages name the selected fallback and arbitrary parser errors keep identity',()=>withEnv([undefined,'invalid',undefined],()=>{
      assert.throws(()=>quiet().addOption(option().choices(['red'])).parse([],{from:'user'}),e=>e.code==='commander.invalidArgument'&&e.message.includes(keys[1]));
      const sentinel=new Error('sentinel');assert.throws(()=>quiet().addOption(option().argParser(()=>{throw sentinel;})).parse([],{from:'user'}),e=>e===sentinel);
    }));
    test('boolean presence, fallback snapshots, reconfiguration and help stay consistent',()=>withEnv([undefined,'',undefined],()=>{
      const names=[keys[1],keys[2]],opt=new Option('--color').env(keys[0],names);names[0]='UNRELATED';
      const c=quiet().addOption(opt);c.parse([],{from:'user'});assert.equal(c.opts().color,true);
      const description=new Help().optionDescription(opt);assert(description.includes(keys.join(', ')));
      opt.env(keys[0]);const reset=quiet().addOption(opt);reset.parse([],{from:'user'});assert.equal(reset.opts().color,undefined);
    }));
  } else throw Error('Unknown fixture kind');
};

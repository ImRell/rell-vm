# Rell VM

A JavaScript obfuscator powered by a custom virtual machine.

Rell VM transpiles modern JavaScript to ES5, compiles it into a custom WASM-like text instruction format, and bundles the program with its runtime into a standalone JavaScript file.

This format is not WebAssembly and does not require a WebAssembly engine.

## Features

- Modern JavaScript normalization through Babel.
- Custom text-based VM instructions.
- Functions, closures, objects, arrays, and exception handling.
- Access to the host JavaScript environment.
- Variable and parameter name mangling.
- Randomized instruction names.
- Whole-program encryption.
- Lazy decryption of string operands and protected nested function bodies.
- Internal runtime property mangling.
- Removal of unused opcode handlers.
- Runtime minification and masked VM diagnostics.

Obfuscation is enabled by default.

## Installation

Requires a modern Node.js version. Node.js 24 is recommended.

```sh
npm install
```

## Usage

```sh
node bin/jsvm.js examples/input.js --output examples/output.js
```

Run the generated file with Node.js:

```sh
node examples/output.js
```

Or include it in a browser:

```html
<script src="examples/output.js"></script>
```

The output includes the VM runtime and does not require the project dependencies to execute.

Existing output files are not overwritten. Remove the old file or choose a new output path before rebuilding.

### Example

Input file: `examples/input.js`:

```js
console.log('Hello, World!');
```

Output file (obfuscated) `examples/output.js`:

```js
(()=>{var ge=/(?:)/.constructor;function G(e,t){if(typeof e!="string"||typeof t!="string")throw new TypeError("???");if(!/^[gim]*$/.test(t))throw new SyntaxError("???");return new ge(e,t)}var j=Object.freeze({_rell_vm_7452c40f:I([],0,0,"_rell_vm_7452c40f"),_rell_vm_40f79e34:I(["literal"],0,1),_rell_vm_c5a11745:I(["name"],0,1),_rell_vm_5ac08b6b:I([],2,1),_rell_vm_ee15ac84:I([],1,0),_rell_vm_08394f01:I([],1,2),_rell_vm_6020d2f5:I(["count"],2,1)}),W=Object.freeze({_rell_vm_7e48f990:Object.freeze({_rell_vm_b4d8f86e:Object.freeze(["_rell_vm_7e48f990"])})});function I(e,t,r,n="next"){return Object.freeze({_rell_vm_b4d8f86e:Object.freeze([...e]),_rell_vm_6d96b972:t,_rell_vm_2d1330c1:r,_rell_vm_6026f352:n})}function ee(e){if(typeof e!="string")throw new TypeError("???");let t=e.split(/\r\n|\n|\r/),r=[];for(let n=0;n<t.length;n++){let o=n+1,i=me(t[n],o);i.length>0&&r.push({_rell_vm_b822f5be:o,tokens:i})}return r}function me(e,t){let r=[],n=0;for(;n<e.length;){if(J(e[n])){n++;continue}let o=n;if(e[n]==='"'){n++;let i=!1;for(;n<e.length;){let c=e[n];if(c==="\\"){n+=2;continue}if(c==='"'){n++,i=!0;break}n++}i||S(t,o+1,"???");let s=e.slice(o,n),l;try{l=JSON.parse(s)}catch{S(t,o+1,"???")}n<e.length&&!J(e[n])&&S(t,n+1,"???"),r.push({type:"string",value:l,_rell_vm_31f9f842:o+1});continue}for(;n<e.length&&!J(e[n]);){let i=e[n];i==='"'&&S(t,n+1,"???"),i.charCodeAt(0)<32&&S(t,n+1,"???"),n++}r.push({type:"word",value:e.slice(o,n),_rell_vm_31f9f842:o+1})}return r}function J(e){return e===" "||e==="	"}function S(e,t,r){throw new SyntaxError("???")}var be=/^[A-Za-z_][A-Za-z0-9_]*$/,Ee=/^(?:0|[1-9][0-9]*)$/,_e=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/,Oe=/^-?(?:0|[1-9][0-9]*)n$/,te=new Map([["undefined",void 0],["null",null],["true",!0],["false",!1],["NaN",NaN],["Infinity",1/0],["-Infinity",-1/0]]);function N(e,{_rell_vm_3c4d6ed7:t}={}){if(t!==void 0&&typeof t!="function")throw new TypeError("???");let r=ee(e),n=[],o=new Map;for(let{_rell_vm_b822f5be:i,tokens:s}of r){let l=s[0];l.type!=="word"&&h(i,l._rell_vm_31f9f842,"???");let c=l.value,y;Object.hasOwn(j,c)?y=j[c]:Object.hasOwn(W,c)?y=W[c]:h(i,l._rell_vm_31f9f842,"???");let a=s.slice(1);a.length!==y._rell_vm_b4d8f86e.length&&h(i,l._rell_vm_31f9f842,"???");let u=[],m=new Set;if(y._rell_vm_b4d8f86e.forEach((f,g)=>{let p=a[g];p.type==="word"&&p.value.startsWith("@")?((!/^@[a-f0-9]{16}$/.test(p.value)||!t||!["literal","name","text","parameters"].includes(f))&&h(i,p._rell_vm_31f9f842,"???"),m.add(g),Object.defineProperty(u,g,{enumerable:!0,get(){let w=t(p.value);return typeof w!="string"&&h(i,p._rell_vm_31f9f842,"???"),re({type:"string",value:w,_rell_vm_31f9f842:p._rell_vm_31f9f842},f,i)}})):u[g]=re(p,f,i)}),c==="_rell_vm_48099824"&&m.size===0)try{G(u[0],u[1])}catch{h(i,l._rell_vm_31f9f842,"???")}if((c==="_rell_vm_dcea56ab"||c==="_rell_vm_dd0b1aa7")&&(c==="_rell_vm_dd0b1aa7"&&!m.has(0)&&u[0].length===0&&h(i,a[0]._rell_vm_31f9f842,"???"),!m.has(1)&&u[2]&&new Set(u[1]).size!==u[1].length&&h(i,a[1]._rell_vm_31f9f842,"???"),!m.has(3)))try{N(u[3],{_rell_vm_3c4d6ed7:t})}catch(f){if(!(f instanceof SyntaxError))throw f;h(i,a[3]._rell_vm_31f9f842,"???")}if(c==="_rell_vm_7e48f990"){let f=u[0];o.has(f)&&h(i,l._rell_vm_31f9f842,"???"),o.set(f,n.length);continue}n.push({_rell_vm_ce79e7d1:c,_rell_vm_fa9cba8e:u,_rell_vm_b822f5be:i,_rell_vm_31f9f842:l._rell_vm_31f9f842})}if(n.length===0)throw new SyntaxError("???");for(let i of n){let s=j[i._rell_vm_ce79e7d1]._rell_vm_6026f352;if(s==="_rell_vm_ff8456bf"||s==="branch"){let l=i._rell_vm_fa9cba8e[0];o.has(l)||h(i._rell_vm_b822f5be,i._rell_vm_31f9f842,"???");let c=o.get(l);c>=n.length&&h(i._rell_vm_b822f5be,i._rell_vm_31f9f842,"???"),i._rell_vm_a7b1a675=c}i._rell_vm_ce79e7d1==="_rell_vm_56438e00"&&(i._rell_vm_056391a0=Object.freeze(i._rell_vm_fa9cba8e.slice(0,3).map(l=>{o.has(l)||h(i._rell_vm_b822f5be,i._rell_vm_31f9f842,"???");let c=o.get(l);return c>=n.length&&h(i._rell_vm_b822f5be,i._rell_vm_31f9f842,"???"),c})),!i._rell_vm_fa9cba8e[3]&&!i._rell_vm_fa9cba8e[4]&&h(i._rell_vm_b822f5be,i._rell_vm_31f9f842,"???")),Object.freeze(i._rell_vm_fa9cba8e),Object.freeze(i)}return Object.freeze({version:1,_rell_vm_587e1028:Object.freeze(n)})}function re(e,t,r){if(t==="text")return e.type!=="string"&&h(r,e._rell_vm_31f9f842,"???"),e.value;if(t==="parameters"){e.type!=="string"&&h(r,e._rell_vm_31f9f842,"???");let o;try{o=JSON.parse(e.value)}catch{h(r,e._rell_vm_31f9f842,"???")}return(!Array.isArray(o)||o.some(i=>typeof i!="string"||i.length===0))&&h(r,e._rell_vm_31f9f842,"???"),Object.freeze(o)}if(t==="literal")return Te(e,r);if(t==="name")return(e.type!=="string"||e.value.length===0)&&h(r,e._rell_vm_31f9f842,"???"),e.value;e.type!=="word"&&h(r,e._rell_vm_31f9f842,"???");let n=e.value;switch(t){case"slot":case"count":{let o=Number(n);if(!Ee.test(n)||!Number.isSafeInteger(o)){let i=t==="slot"?"slot":"argument count";h(r,e._rell_vm_31f9f842,"???")}return o}case"boolean":return n!=="true"&&n!=="false"&&h(r,e._rell_vm_31f9f842,"???"),n==="true";case"bindingKind":return n!=="let"&&n!=="const"&&h(r,e._rell_vm_31f9f842,"???"),n;case"_rell_vm_7e48f990":return be.test(n)||h(r,e._rell_vm_31f9f842,"???"),n;default:throw new Error("???")}}function Te(e,t){if(e.type==="string")return e.value;let r=e.value;if(te.has(r))return te.get(r);if(Oe.test(r))return BigInt(r.slice(0,-1));if(_e.test(r)){let n=Number(r);return Number.isFinite(n)||h(t,e._rell_vm_31f9f842,"???"),n}h(t,e._rell_vm_31f9f842,"???")}function h(e,t,r){throw new SyntaxError("???")}var P=class{#t;#e;#r=!1;#n=void 0;constructor(t,r){if(typeof t!="string"||t.length===0)throw new TypeError("???");if(r!=="let"&&r!=="const")throw new TypeError("???");this.#t=t,this.#e=r}_rell_vm_5e492d3f(t){if(this.#r)throw new Error("???");this.#n=t,this.#r=!0}_rell_vm_6748cb0e(){return this.#o(),this.#n}_rell_vm_458c9491(t){if(this.#o(),this.#e==="const")throw new TypeError("???");return this.#n=t,t}#o(){if(!this.#r)throw new ReferenceError("???")}};var D=class extends P{constructor(t){super(t,"const")}_rell_vm_792122cc(t,r){if(typeof r!="boolean")throw new TypeError("???");return this._rell_vm_6748cb0e(),r&&this._rell_vm_458c9491(t),t}};function x(e,t){if(!Number.isSafeInteger(e)||e<0)throw new TypeError("???")}var O=class e{#t;#e=new Map;constructor(t=null){if(t!==null&&!(t instanceof e))throw new TypeError("???");this.#t=t}get _rell_vm_76d1b405(){return this.#t}_rell_vm_fde80856(){return new e(this)}create(t,r,n){if(x(t,"Slot"),this.#e.has(t))throw new Error("???");let o=new P(r,n);return this.#e.set(t,o),o}_rell_vm_dfc87b64(t,r){if(x(t,"Slot"),this.#e.has(t))throw new Error("???");let n=new D(r);return this.#e.set(t,n),n}_rell_vm_78dd759f(t,r,n){x(t,"Slot");let o=new P(r,n);return this.#e.set(t,o),o}_rell_vm_b146848f(t,r=0){x(t,"Slot"),x(r,"Depth");let n=this;for(let o=0;o<r;o++)if(n=n.#t,n===null)throw new Error("???");if(!n.#e.has(t))throw new Error("???");return n.#e.get(t)}};var F=new WeakMap,C=new WeakMap,Q=Object.defineProperty,T=class{static[Symbol.hasInstance](t){return F.has(t)}constructor({name:t="",_rell_vm_5975b0ca:r=[],_rell_vm_94aeddd5:n=!1,_rell_vm_dc10a77a:o,_rell_vm_e1fbe815:i,_rell_vm_1acd88df:s=!0,_rell_vm_3c4d6ed7:l}={}){if(l!==void 0&&typeof l!="function"||typeof s!="boolean"||typeof t!="string"||!Array.isArray(r)||typeof n!="boolean"||typeof o!="string"||!(i instanceof O))throw new TypeError("???");let c=new Set;for(let u of r){if(typeof u!="string"||u.length===0)throw new TypeError("???");if(n&&c.has(u))throw new SyntaxError("???");c.add(u)}let y=Object.freeze({_rell_vm_5975b0ca:Object.freeze([...r]),_rell_vm_94aeddd5:n,_rell_vm_dc10a77a:o,_rell_vm_33182618:N(o,{_rell_vm_3c4d6ed7:l}),_rell_vm_e1fbe815:i}),a=function(...u){let m=C.get(a);if(m===void 0)throw new TypeError("???");return m(a,this,u)};if(F.set(a,y),Q(a,"name",{value:t,configurable:!0}),Q(a,"length",{value:r.length,configurable:!0}),s)for(let[u,m]of Object.entries(y))Q(a,u,{value:m});return a}};function Y(e){return C.get(e)}function ne(e,t){if(!F.has(e)||typeof t!="function")throw new TypeError("???");return C.has(e)||C.set(e,t),e}function U(e){let t=F.get(e);if(t===void 0)throw new TypeError("???");return t}var ie=Reflect.apply,ve=String,Ae=Symbol.toPrimitive,k=TypeError;function H(e){return e===null||typeof e!="object"&&typeof e!="function"}function oe(e){return typeof e=="function"||e instanceof T}function fe(e,t,r=ie){if(H(e))return e;let n=e[Ae];if(n!=null){if(!oe(n))throw new k("???");let i=r(n,e,[t]);if(!H(i))throw new k("???");return i}let o=t==="string"?["toString","valueOf"]:["valueOf","toString"];for(let i of o){let s=e[i];if(!oe(s))continue;let l=r(s,e,[]);if(H(l))return l}throw new k("???")}function X(e,t=ie){let r=fe(e,"string",t);return typeof r=="symbol"?r:ve(r)}var $e=Object.getPrototypeOf(Re()).next;function*Re(e){for(let t in e)yield t}var et=Number.isInteger;function Ie(){throw new TypeError("???")}Object.freeze(Ie);var L=class{#t;#e;#r;#n;_rell_vm_26414d54=0;_rell_vm_adabf7fb=[];_rell_vm_3ef028e6=new Map;constructor({_rell_vm_e2cac66f:t=null,_rell_vm_fa9cba8e:r=[],_rell_vm_d8abf9f7:n=void 0}={}){if(t!==null&&!(t instanceof O))throw new TypeError("???");if(!Array.isArray(r))throw new TypeError("???");this.#r=Object.freeze([...r]),this.#n=n,this.#t=new O(t),this.#e=this.#t}get _rell_vm_d21cbcfc(){return this.#t}get _rell_vm_037d6d31(){return this.#e}get _rell_vm_fa9cba8e(){return this.#r}get _rell_vm_d8abf9f7(){return this.#n}_rell_vm_3c1f863c(){return this.#e=this.#e._rell_vm_fde80856()}_rell_vm_a159ea5d(t){if(!(t instanceof O))throw new TypeError("???");let r=t;for(;r!==null&&r!==this.#t;)r=r._rell_vm_76d1b405;if(!(t instanceof O)||r!==this.#t)throw new TypeError("???");this.#e=t}_rell_vm_afd36fdb(){if(this.#e===this.#t)throw new Error("???");return this.#e=this.#e._rell_vm_76d1b405}};function se(e,t){if(typeof e!="string"||e.length===0)throw new TypeError("???");if(t===null||typeof t!="object"&&typeof t!="function")throw new TypeError("???");if(!Reflect.has(t,e))throw new ReferenceError("???");return Reflect.get(t,e)}var ce=Reflect.apply;function ue(e,{_rell_vm_6003e454:t=1/0,_rell_vm_037d6d31:r=globalThis,_rell_vm_7ebec153:n=!0,_rell_vm_3c4d6ed7:o}={}){if(t!==1/0&&(!Number.isSafeInteger(t)||t<=0))throw new TypeError("???");if(r===null||typeof r!="object"&&typeof r!="function")throw new TypeError("???");if(typeof n!="boolean")throw new TypeError("???");let i=[{_rell_vm_33182618:N(e,{_rell_vm_3c4d6ed7:o}),_rell_vm_33b397da:new L({_rell_vm_d8abf9f7:r})}],s=0,l=new WeakSet;try{return c(0)}finally{i.length=0}function c(f){for(;i.length>f;){let g=i[i.length-1],{_rell_vm_33b397da:p}=g,{_rell_vm_587e1028:w}=g._rell_vm_33182618;p._rell_vm_26414d54>=w.length&&B(w[w.length-1],"???");let A=w[p._rell_vm_26414d54],{_rell_vm_ce79e7d1:z,_rell_vm_fa9cba8e:d}=A,ye=j[z],{_rell_vm_adabf7fb:E,_rell_vm_3ef028e6:je}=p;if(s>=t){let b=new Error("???");throw l.add(b),b}E.length<ye._rell_vm_6d96b972&&B(A,"???"),s++,p._rell_vm_26414d54++;try{switch(z){case"_rell_vm_7452c40f":{let b=a({type:"_rell_vm_4976e33e",value:void 0},f);if(b.done)return b.value;break}case"_rell_vm_40f79e34":E.push(d[0]);break;case"_rell_vm_c5a11745":E.push(y(se(d[0],r)));break;case"_rell_vm_5ac08b6b":{let b=E.pop(),_=E.pop();E.push(y(_[u(_,b)]));break}case"_rell_vm_ee15ac84":E.pop();break;case"_rell_vm_08394f01":E.push(E[E.length-1]);break;case"_rell_vm_6020d2f5":{d[0]>E.length-2&&B(A,"???");let b=E.splice(E.length-d[0],d[0]),_=y(E.pop()),$=E.pop();for(let we of b)y(we);_ instanceof T&&Y(_)===m?i.push({_rell_vm_33182618:U(_)._rell_vm_33182618,fn:_,_rell_vm_33b397da:le(_,$,b,r)}):E.push(ce(_,$,b));break}default:B(A,"???")}}catch(b){if(b!==null&&(typeof b=="object"||typeof b=="function")&&l.has(b))throw b;let _=a({type:"_rell_vm_120ceb8f",value:b},f);if(_.done)return _.value}}}function y(f){return f instanceof T&&ne(f,m),f}function a(f,g){for(;i.length>g;){let p=i.at(-1),w=p._rell_vm_33b397da,A=p._rell_vm_7af1137d??=[],z=f.type==="_rell_vm_ff8456bf"?f.handlerDepth:0;for(;A.length>z;){let d=A.at(-1);if(w._rell_vm_a159ea5d(d._rell_vm_037d6d31),w._rell_vm_adabf7fb.length=d._rell_vm_9411b616,f.type==="_rell_vm_120ceb8f"&&d._rell_vm_e92a0954==="try"&&d._rell_vm_197d17c2)return d._rell_vm_e92a0954="catch",d.error=f.value,w._rell_vm_26414d54=d._rell_vm_d015173d,{done:!1};if(d._rell_vm_e92a0954!=="finally"&&d._rell_vm_daf32ebd)return d._rell_vm_e92a0954="finally",d._rell_vm_d7a15983=f,w._rell_vm_26414d54=d._rell_vm_c7be6c05,{done:!1};A.pop()}if(f.type==="_rell_vm_ff8456bf")return w._rell_vm_a159ea5d(f._rell_vm_037d6d31),w._rell_vm_26414d54=f._rell_vm_a7b1a675,{done:!1};if(i.pop(),f.type==="_rell_vm_4976e33e")return i.length===g?{done:!0,value:f.value}:(i.at(-1)._rell_vm_33b397da._rell_vm_adabf7fb.push(f.value),{done:!1})}throw f.value}function u(f,g){return f==null?g:X(g,m)}function m(f,g,p){if(y(f),!(f instanceof T)||Y(f)!==m)return ce(f,g,p);let w=i.length;i.push({_rell_vm_33182618:U(f)._rell_vm_33182618,fn:f,_rell_vm_33b397da:le(f,g,p,r)});try{return c(w)}finally{i.length=w}}}function le(e,t,r,n){let o=U(e),i=new L({_rell_vm_e2cac66f:o._rell_vm_e1fbe815,_rell_vm_fa9cba8e:r,_rell_vm_d8abf9f7:o._rell_vm_94aeddd5?t:t==null?n:Object(t)}),s=new Map;for(let l=0;l<o._rell_vm_5975b0ca.length;l++){let c=o._rell_vm_5975b0ca[l];if(s.has(c)){i._rell_vm_d21cbcfc._rell_vm_b146848f(s.get(c))._rell_vm_458c9491(r[l]);continue}let y=s.size;s.set(c,y),i._rell_vm_d21cbcfc.create(y,c,"let")._rell_vm_5e492d3f(r[l])}return i}function B(e,t){throw new Error("???")}var V="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";function v(){throw new Error("???")}function M(e){(typeof e!="string"||e.length%4!==0)&&v();let t=e.endsWith("==")?2:e.endsWith("=")?1:0,r=new Uint8Array(e.length/4*3-t),n=0;for(let o=0;o<e.length;o+=4){let i=V.indexOf(e[o]),s=V.indexOf(e[o+1]),l=e[o+2]==="="?0:V.indexOf(e[o+2]),c=e[o+3]==="="?0:V.indexOf(e[o+3]);o+4===e.length&&(t===2&&s&15||t===1&&l&3)&&v(),(i<0||s<0||l<0||c<0||o+4!==e.length&&(e[o+2]==="="||e[o+3]==="=")||e[o+2]==="="&&e[o+3]!=="=")&&v();let y=i<<18|s<<12|l<<6|c;n<r.length&&(r[n++]=y>>>16),n<r.length&&(r[n++]=y>>>8),n<r.length&&(r[n++]=y)}return r}function ae(e,t){return(e[t]|e[t+1]<<8|e[t+2]<<16|e[t+3]<<24)>>>0}function Z(e,t){return e<<t|e>>>32-t}function R(e,t,r,n,o){e[t]+=e[r],e[o]=Z(e[o]^e[t],16),e[n]+=e[o],e[r]=Z(e[r]^e[n],12),e[t]+=e[r],e[o]=Z(e[o]^e[t],8),e[n]+=e[o],e[r]=Z(e[r]^e[n],7)}function he(e,t,r){(!(e instanceof Uint8Array)||e.length!==32||!(t instanceof Uint8Array)||t.length!==12||!Number.isInteger(r)||r<0||r>4294967295)&&v();let n=new Uint32Array(16);n.set([1634760805,857760878,2036477234,1797285236]);for(let s=0;s<8;s++)n[4+s]=ae(e,s*4);n[12]=r;for(let s=0;s<3;s++)n[13+s]=ae(t,s*4);let o=new Uint32Array(n);for(let s=0;s<10;s++)R(o,0,4,8,12),R(o,1,5,9,13),R(o,2,6,10,14),R(o,3,7,11,15),R(o,0,5,10,15),R(o,1,6,11,12),R(o,2,7,8,13),R(o,3,4,9,14);let i=new Uint8Array(64);for(let s=0;s<16;s++){let l=o[s]+n[s]>>>0;for(let c=0;c<4;c++)i[s*4+c]=l>>>c*8}return i}function q(e){let t=0n;for(let r=e.length-1;r>=0;r--)t=t<<8n|BigInt(e[r]);return t}function Pe(e,t,r){let n=he(t,r,0),o=q(n.subarray(0,16))&0x0ffffffc0ffffffc0ffffffc0fffffffn,i=q(n.subarray(16,32)),s=(1n<<130n)-5n,l=0n;for(let a=0;a<e.length;a+=16){let u=new Uint8Array(16);u.set(e.subarray(a,a+16)),l=(l+q(u)+(1n<<128n))*o%s}l=(l+(BigInt(e.length)<<64n)+(1n<<128n))*o%s;let c=l+i&(1n<<128n)-1n,y=new Uint8Array(16);for(let a=0;a<16;a++)y[a]=Number(c&255n),c>>=8n;return y}function K(e){(!e||typeof e!="object"||e.v!==1||!Array.isArray(e.k)||e.k.length!==2||!Array.isArray(e.c)||!Array.isArray(e.o)||e.c.length!==e.o.length||e.c.length===0)&&v();let t=M(e.k[0]),r=M(e.k[1]),n=M(e.n),o=M(e.t);(t.length!==32||r.length!==32||n.length!==12||o.length!==16)&&v();let i=new Uint8Array(32);for(let f=0;f<32;f++)i[f]=t[f]^r[f];let s=new Set,l=[];for(let f of e.o)(!Number.isInteger(f)||f<0||f>=e.c.length||s.has(f)||typeof e.c[f]!="string")&&v(),s.add(f),l.push(e.c[f]);let c=M(l.join(""));(c.length%2!==0||Math.ceil(c.length/64)>4294967295)&&v();let y=Pe(c,i,n),a=0;for(let f=0;f<16;f++)a|=y[f]^o[f];a!==0&&v();let u=new Uint8Array(c.length);for(let f=0,g=1;f<c.length;f+=64,g++){let p=he(i,n,g);for(let w=0;w<64&&f+w<c.length;w++)u[f+w]=c[f+w]^p[w]}let m=[];for(let f=0;f<u.length;f+=8192){let g=[];for(let p=f;p<Math.min(f+8192,u.length);p+=2)g.push(u[p]|u[p+1]<<8);m.push(String.fromCharCode(...g))}return i.fill(0),u.fill(0),m.join("")}function pe(e){if(!Array.isArray(e))throw new TypeError("???");let t=JSON.parse(JSON.stringify(e)),r=new Map;for(let n of t){if(!Array.isArray(n)||n.length!==2||typeof n[0]!="string"||!/^[a-f0-9]{16}$/.test(n[0])||r.has(n[0]))throw new TypeError("???");r.set(n[0],n[1])}return function(o){if(typeof o!="string"||!/^@[a-f0-9]{16}$/.test(o)||!r.has(o.slice(1)))throw new TypeError("???");return K(r.get(o.slice(1)))}}ue(K({v:1,k:["cqPe4XwZZs1ctehcMLueE3ZiT508KrEYdEwlk5uxCFQ=","/5LcZ00EH6QxTZM/EsgxEsQcQ9LgI2XWZxwBdia4Riw="],n:"3hH6veNcCb842ygu",t:"UAaoFrHh9rWRrX2sizERig==",c:["RtMu+hhhX2pTmqFCbB+l0FK1HiLBjkXAT1vwHBexnz+Bk805NcHKLjsKdYcc2td/vyTRt552ib6HiO1u5DDumDkGB0bv2VV0uJeNUZcMvYEykO/Una/Di73tSnAOPRF91tQ+zMl++2H4B/QD/ss8IBmCe9dz4MuBHszLImU6llXcZsD7NvkdxYsqsu2ltDTSd48JMVpj0HLbw6fRgf8+jSyTxn82jofZZz1OROYvsMh32OZIrlUBadHCR1zAeoMXdbCVggkLDLxPlJVXw+Us3enxudHIX6TqAkWON9uZjQoRpRVAyiOR5vbA2hxSqbWUKoqQDB/cDRD4fubhteYjPq8M9JUgd4AF5EW6UTgbjbtQT3WpEYq7xcVvmpO4V5pWNMIZRUF22Mto/Yz7GPorvgbYSfOCsvRCOVlks6IuH20Jp7qoM9yyFZTmZgNB0QS1qqoTVdxkjLDbd0xC/xWw3lNSG4PXkpPIBpAgeDygDLdmZNSPFbNIOLLMfpgmK1yQVbz7pn3Ssw42AlCte58="],o:[0]}),{_rell_vm_3c4d6ed7:pe([["7d619b79526fc469",{v:1,k:["5ajmQMesNX30K7241h8qEyS0uJaSuNKHXIZhW3em76w=","cPvDYo7sL+ZzLy+SxsHTwkhBkv9kiYYQDML9dvxiyns="],n:"rZtpTUBdZd/LrAgg",t:"mIeK/p6JgDngXh11gdvzpQ==",c:["dDqCRZA2T0LJu0CL2QCYIwl3fJBHpIvU2C4="],o:[0]}],["a5ed0bf405d665a6",{v:1,k:["vmY/UPxlJtvJFWolhzaE+RC2eMl14JjbRBWmgsZjR8o=","OWR/k4kuPG3n9t1SA8S+lUD4aNGwC+vlrDsIyspKU/8="],n:"CrQgJYfDllAfQMVR",t:"eUYaoXpsfKs2CIIKWJavRQ==",c:["PCJDtWKu"],o:[0]}],["00413f532755f36e",{v:1,k:["JOaioB8vFxLNYBJOFeKd76Mi6PF5TkrgW/yo9R0RrcE=","C2pe7TshiMvYkk0f1QVQmtNkXSOEWi6kBO6BTTX8n/E="],n:"dKyx3v7TkAEPZ+L9",t:"TrhxnUAlvDPiw73uCF986Q==",c:["UtFzox3YMFbFH33hK28="],o:[0]}]]),_rell_vm_7ebec153:!1});})();
```

## Options

Show all available options:

```sh
node bin/jsvm.js --help
```

Common options:

| Option | Description |
| --- | --- |
| `-o, --output <path>` | Set the output file path. |
| `--keep-function-names` | Preserve observable function names. |
| `--no-normalize` | Skip Babel normalization. |
| `--no-mangle-names` | Disable variable and parameter metadata mangling. |
| `--no-encrypt-program` | Disable whole-program encryption. |
| `--no-protect-strings` | Disable string operand encryption. |
| `--no-randomize-instructions` | Keep canonical instruction names. |
| `--no-mangle-properties` | Keep internal VM property names. |
| `--no-prune-opcodes` | Keep all opcode handlers. |
| `--no-mask-errors` | Keep detailed VM diagnostics. |
| `--no-minify` | Keep readable runtime formatting. |

String protection is independent of whole-program encryption. Disabling `--no-encrypt-program` alone does not expose string operands.

## Testing

```sh
npm test
```

To reduce parallel test load:

```sh
node --test --test-concurrency=2
```

## Limitations

Rell VM is an obfuscation tool, not a security sandbox or a place to store secrets. A debugger can inspect runtime values and intercept decrypted strings.

Not every JavaScript behavior is supported. Transpiling input to ES5 does not guarantee full ES5 compatibility, provide missing platform APIs, or make the generated runtime compatible with old ES5-only browsers.

Obfuscation adds output size and execution overhead. Name mangling and masked diagnostics can also change observable names and error messages.
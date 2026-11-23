import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inflateRawSync} from 'node:zlib';

const {TEST_API_URL: base, TEST_ADMIN_EMAIL: email, TEST_ADMIN_PASSWORD: password} = process.env;
const seed = Date.now().toString(36);
const date = '2025-05-14';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBxsAAAAASUVORK5CYII=', 'base64');
let token, cookie;
const csrf = {'X-Requested-With': 'DrivingSchool'};

async function request(path, status, {method='GET', body, auth=true, headers={}} = {}) {
  const response = await fetch(base+'/api'+path, {
    method, headers: {...(auth && token ? {Authorization:'Bearer '+token} : {}),
      ...(body!==undefined && !(body instanceof FormData) ? {'Content-Type':'application/json'} : {}), ...headers},
    body: body===undefined || body instanceof FormData ? body : JSON.stringify(body)
  });
  const type = response.headers.get('content-type') ?? '';
  const result = await (type.includes('json') ? response.json() : response.arrayBuffer().then(x=>Buffer.from(x)))
    .catch(error=>{throw new Error(method+' '+path+' prekinut odgovor', {cause:error});});
  assert.equal(response.status, status, method+' '+path+' '+JSON.stringify(Buffer.isBuffer(result)?result.subarray(0,60).toString():result));
  return {response,result};
}
const get = async (path, status=200) => (await request(path,status)).result;
const post = async (path, body, status=200, options={}) => (await request(path,status,{method:'POST',body,...options})).result;
const put = async (path, body, status=200) => (await request(path,status,{method:'PUT',body})).result;
function upload(name='scan.png', bytes=png, type='image/png') {
  const data = new FormData();
  data.set('documentTypeId','1');
  data.append('files',new Blob([bytes],{type}),name);
  return data;
}

test('Tok vlasnika kroz API i PostgreSQL', async t => {
  assert.ok(base&&email&&password,'Postavite TEST_API_URL, TEST_ADMIN_EMAIL i TEST_ADMIN_PASSWORD za zasebnu testnu bazu.');
  let school, other, first, second, third, documentId, document, book, one, two, payment;
  const candidate = (id, firstName='Amra', status='ACTIVE') => ({
    drivingSchoolId:id, firstName, lastName:'Čović', fatherName:'Đuro', dateOfBirth:'2000-01-02',
    municipalityOfBirth:'Živinice', drivingCategory:'B', enrollmentDate:date, status, agreedPrice:1200.15, currencyCode:'BAM'
  });

  await t.test('Prijava, rotacija kolačića i zaštita od neovlaštenog pristupa', async () => {
    await request('/schools',401);
    await post('/auth/login',{email,password},403,{auth:false});
    await post('/auth/login',{email,password:'pogrešna lozinka'},401,{headers:csrf,auth:false});
    const login = await request('/auth/login',200,{method:'POST',body:{email,password},headers:csrf,auth:false});
    token = login.result.accessToken;
    const original = login.response.headers.get('set-cookie');
    assert.match(original,/httponly/i);
    assert.match(original,/samesite=strict/i);
    const rotated = await request('/auth/refresh',200,{method:'POST',headers:{...csrf,Cookie:original.split(';')[0]},auth:false});
    await get('/auth/me',401);
    token = rotated.result.accessToken;
    cookie = rotated.response.headers.get('set-cookie').split(';')[0];
    await post('/auth/refresh',{},401,{headers:{...csrf,Cookie:original.split(';')[0]},auth:false});
    assert.equal((await get('/auth/me')).email,email);
    const spec = await fetch(base+'/swagger/v1/swagger.json');
    assert.equal(spec.status,200);
    const paths=(await spec.json()).paths;
    assert.ok(paths['/api/register-books/{id}/entries']);
    assert.ok(paths['/api/candidates/{id}/documents'].post.requestBody.content['multipart/form-data']);
  });

  await t.test('Autoškole, kreiranje kandidata i filtriranje na serveru', async () => {
    const make = name=>post('/schools',{name,address:'',city:'Sarajevo',phone:'',email:'',isActive:true},201);
    school=await make('Test '+seed);
    other=await make('Druga '+seed);
    assert.ok((await get('/schools')).some(row=>row.id===school.id&&row.data.name===school.data.name));
    await post('/candidates',{candidate:candidate(0)},400);
    const identified={...candidate(school.id),jmbg:'0000000000000'};
    first=await post('/candidates',{candidate:identified},201);
    await post('/candidates',{candidate:identified},409);
    second=await post('/candidates',{candidate:candidate(school.id,'Šejla')},201);
    const outside=await post('/candidates',{candidate:candidate(other.id,'Edin')},201);
    const filtered=await get('/candidates?schoolId='+school.id+'&search='+encodeURIComponent('Čović')+'&year=2025&pageSize=1');
    assert.equal(filtered.total,2);
    assert.equal(filtered.items.length,1);
    assert.equal(filtered.items[0].id,second.id);
    assert.equal((await get('/candidates/'+first.id)).schoolName,school.data.name);
    await put('/candidates/'+first.id,{candidate:candidate(other.id)},400);
    assert.equal((await get('/dashboard/overview?schoolId='+school.id)).total,2);
    assert.equal((await get('/candidates?schoolId='+other.id)).items[0].id,outside.id);
    book=await post('/register-books',{drivingSchoolId:school.id,year:2027,capacity:2},201);
    const otherBook=await post('/register-books',{drivingSchoolId:other.id,year:2027,capacity:4},201);
    assert.notEqual(book.id,otherBook.id);
    assert.deepEqual((await get('/register-books?schoolId='+school.id)).map(x=>x.id),[book.id]);
    assert.deepEqual((await get('/register-books?schoolId='+other.id)).map(x=>x.id),[otherBook.id]);
    await post('/register-books',{drivingSchoolId:school.id,year:2027,capacity:2},409);
    await post('/register-books/'+book.id+'/entries',{candidateId:outside.id,expectedSerial:1,fields:{}},400);
  });

  await t.test('Dodjela instruktora iz odgovarajuće autoškole', async () => {
    const make=(firstName,schoolIds)=>post('/instructors',{firstName,lastName:'Test',isActive:true,schoolIds});
    const a=await make('Sanja',[school.id,other.id]), b=await make('Irma',[school.id]), outside=await make('Damir',[other.id]);
    const path='/candidates/'+first.id+'/assignments';
    await put(path,[{instructorId:outside.id,allocationPercentage:100}],400);
    await put(path,[{instructorId:a.id,allocationPercentage:99}],400);
    await put(path,[{instructorId:a.id,allocationPercentage:50},{instructorId:a.id,allocationPercentage:50}],400);
    await put(path,[{instructorId:a.id,allocationPercentage:49.99},{instructorId:b.id,allocationPercentage:50.01}],204);
    const profile=await get('/candidates/'+first.id);
    assert.equal(profile.assignments[0].instructorId,a.id);
    assert.equal(profile.assignments[1].allocationPercentage,50.01);
    await request('/candidates/'+first.id+'/status',204,{method:'PATCH',body:{status:'COMPLETED',completionDate:'2025-06-01'}});
    await put(path,[],400);
    assert.equal((await get('/instructors/'+a.id+'?schoolId='+school.id)).candidates.length,1);
  });

  await t.test('Potvrda OCR unosa, učitavanje, privatni pregled i ZIP', async () => {
    const staged=await post('/document-extraction/extract',upload());
    assert.equal(staged.length,1);
    assert.equal((await get('/candidates?schoolId='+school.id)).total,2);
    documentId=staged[0].document.id;
    assert.ok(['manual','unrecognized','review','timeout'].includes(staged[0].extraction.status));
    await get('/documents/'+documentId+'/download',404);
    third=await post('/candidates',{candidate:candidate(school.id,'Ena'),uploadIds:[documentId]},201);
    await post('/candidates',{candidate:candidate(school.id,'Duplikat'),uploadIds:[documentId]},409);
    await request('/documents/'+documentId+'/download',401,{auth:false});
    assert.deepEqual(await get('/documents/'+documentId+'/preview'),png);
    assert.deepEqual(await get('/documents/'+documentId+'/download'),png);
    const extra=upload('drugi.png');
    extra.append('files',new Blob([png],{type:'image/png'}),'treci.png');
    await post('/candidates/'+third.id+'/documents',extra);
    await post('/candidates/'+third.id+'/documents',upload('neispravan.png',Buffer.from('Ovo nije slika ni drugi podržani dokument.')),415);
    assert.equal((await get('/candidates/'+third.id+'/documents')).length,3);
    document=await put('/documents/'+documentId,upload('zamjena.png'));
    assert.equal(document.originalFileName,'zamjena.png');
    const zip=await get('/candidates/'+third.id+'/documents/zip');
    assert.equal(zip.readUInt32LE(0),0x04034b50);
    const size=zip.readUInt32LE(18), nameLength=zip.readUInt16LE(26), extraLength=zip.readUInt16LE(28);
    if(size>0)assert.deepEqual(inflateRawSync(zip.subarray(30+nameLength+extraLength,30+nameLength+extraLength+size)),png);
    await request('/documents/'+documentId,204,{method:'DELETE'});
    await get('/documents/'+documentId+'/download',404);
  });

  await t.test('Plaćanje, precizan saldo, izmjena i storno', async () => {
    const path='/candidates/'+first.id+'/payments';
    await post(path,{amount:0,paymentDate:date,paymentMethod:'Gotovina'},400);
    payment=await post(path,{amount:600.12,paymentDate:date,paymentMethod:'Gotovina'},201);
    assert.equal((await get(path)).remaining,600.03);
    await put('/payments/'+payment.id,{amount:600.19,paymentDate:date,paymentMethod:'Kartica'},204);
    assert.equal((await get(path)).remaining,599.96);
    await post('/payments/'+payment.id+'/void',{reason:'Ispravka testne uplate'},204);
    assert.equal((await get(path)).remaining,1200.15);
    assert.ok((await get(path)).items[0].voidedAt);
    await put('/payments/'+payment.id,{amount:5,paymentDate:date,paymentMethod:'Ostalo'},409);

    const settings=await get('/settings');
    const euro={...candidate(other.id,'Emina'),currencyCode:'EUR'};
    if(!settings.enableEur)await post('/candidates',{candidate:euro},400);
    try {
      await put('/settings',{...settings,enableEur:true},204);
      const saved=await post('/candidates',{candidate:euro},201);
      await post('/candidates/'+saved.id+'/payments',{amount:100,paymentDate:date,paymentMethod:'Gotovina'},201);
      const balances=(await get('/dashboard/overview?schoolId='+other.id)).outstanding;
      assert.deepEqual(Object.fromEntries(balances.map(x=>[x.currencyCode,x.total])),{BAM:1200.15,EUR:1100.15});
    } finally { await put('/settings',settings,204); }
  });

  await t.test('Konkurentni upisi, stabilno numerisanje, PDF i arhiva', async () => {
    const root='/register-books/'+book.id;
    const fields={medicalInstitution:'Opća bolnica Živinice',medicalCertificateNumber:'MED-25/17',medicalCertificateDate:date};
    await put(root+'/capacity',{capacity:3});
    assert.equal((await get(root+'/pages/1')).rows.length,3);
    await put(root+'/capacity',{capacity:2});
    const allocate=(candidateId,expectedSerial)=>request(root+'/entries',201,{method:'POST',body:{candidateId,expectedSerial,fields}});
    const concurrent=await Promise.all([first.id,second.id].map(candidateId=>fetch(base+'/api'+root+'/entries',{method:'POST',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({candidateId,expectedSerial:1,fields})})));
    assert.deepEqual(concurrent.map(x=>x.status).sort(),[201,409]);
    one=await concurrent.find(x=>x.status===201).json();
    const losing=one.candidateId===first.id?second.id:first.id;
    two=(await allocate(losing,2)).result;
    await put(root+'/capacity',{capacity:3},409);
    await post(root+'/entries',{candidateId:losing,expectedSerial:3,fields},409);
    await put('/register-entries/'+two.id,{fields:{...fields,note:'Ažurirano'}},204);
    await post('/register-entries/'+one.id+'/void',{reason:''},400);
    await post('/register-entries/'+one.id+'/void',{reason:'Poništavanje testnog upisa'},204);
    const next=(await allocate(third.id,3)).result;
    assert.equal(next.pageNumber,2);
    const page=await get(root+'/pages/1');
    assert.equal(page.rows.length,2);
    assert.equal(page.rows[1].entry.serialNumber,2);
    assert.ok(page.rows[0].entry.voidedAt);
    assert.equal((await get(root+'/pages/2')).rows[1].entry,null);
    const pdf=await get(root+'/export/pdf');
    assert.match(pdf.toString('latin1'),/^%PDF-/);
    assert.match(pdf.toString('latin1'),/\/Count 2\b/);
    await post(root+'/archive',{});
    await put('/register-entries/'+two.id,{fields},409);
    await post('/register-entries/'+two.id+'/void',{reason:'Test'},409);
    await post(root+'/entries',{candidateId:first.id,expectedSerial:4,fields},409);
    assert.equal((await get(root)).pageCount,2);
    assert.match((await get(root+'/export/pdf?page=2')).toString('latin1'),/\/Count 1\b/);
    const large=await post('/register-books',{drivingSchoolId:school.id,year:2028,capacity:20},201);
    assert.equal((await get('/register-books/'+large.id+'/pages/1')).rows.length,20);
    await post('/register-books/'+large.id+'/entries',{candidateId:first.id,expectedSerial:1,fields:{note:'Čelić '.repeat(41),
      medicalInstitution:'Opća zdravstvena ustanova u Živinicama '.repeat(2)}},201);
    assert.match((await get('/register-books/'+large.id+'/export/pdf')).toString('latin1'),/\/Count 1\b/);
  });

  await t.test('Odjava ukida kolačić i pristup pomoću JWT-a', async () => {
    await post('/auth/logout',{},204,{headers:{...csrf,Cookie:cookie},auth:false});
    await get('/auth/me',401);
    await post('/auth/refresh',{},401,{headers:{...csrf,Cookie:cookie},auth:false});
  });
});

/**
 * 太常见的第一串（10-09 补充方案 7-8 第 4 条）：免邮箱账号注册时，第一串撞上这张表就答 400 `common`
 * （「这一串太常见了，换一串。」），大小写不敏感。
 *
 * 为什么只管第一串：它是这种账号的名字，而注册撞名时服务端如实答 409 `taken`，所以它本来就是可以挨个
 * 试出来的那一串（api/handle.js 文件头）。一个人拿 `12345678` 当第一串，外人头一个就会试到它——然后
 * 拿它连错四次第二串，把主人锁在门外四小时，一天六回。第二串是真的密码（7-8 起没有「重设」这条路），
 * 猜它有每个账号「错 4 次锁 4 小时」那道闸管着。
 *
 * 只挡**新注册**：已经用着常见第一串的老账号照样登得进来（handle.js 的 signin 不查这张表）——拒收
 * 一个已经存在的账号等于把人关在门外，那比它要防的事更糟。
 *
 * 表是写死的一份（几百条），不是现场生成的规则：常见密码榜（历年 SplashData / NordPass 榜单、
 * RockYou 那一批泄露里排在前面的）里 8 位以上、只有字母和数字的那些，加上中文圈常见的
 * （woaini1314、5201314、qq123456 一类）、几种键盘走位（1qaz2wsx、q1w2e3r4）、单字重复（八个 a、
 * 八到十个同一个数字）和这个站自己的名字（slides123、fangtang）。少于 8 位或带符号的不收——
 * PAIR_RE 本来就不让它们进来。门：check-handle-auth 的 ⑧。
 */
const COMMON = new Set([
  'a1234567', 'a12345678', 'a123456789', 'a123456a', 'a1314520', 'a1b2c3d4', 'a1b2c3d4e5', 'a5201314',
  'aa112233', 'aa123123', 'aa123456', 'aaaaaaaa', 'abc112233', 'abc12345', 'abc123456', 'abc1234567',
  'abc123abc', 'abcd1234', 'abcd12345', 'abcde12345', 'abcdef12', 'abcdef123', 'abcdefg1', 'abcdefgh',
  'abcdefghi', 'abcdefghij', 'access14', 'accessme', 'admin123', 'admin1234', 'admin12345', 'administrator',
  'aini1314', 'angel123', 'apple123', 'arsenal1', 'asd12345', 'asd123456', 'asdf1234', 'asdfasdf',
  'asdfghjk', 'asdfghjkl', 'asdfqwer', 'autumn12', 'avengers', 'baby1234', 'babyboy1', 'babygirl',
  'barcelona', 'baseball', 'baseball1', 'basketball', 'batman12', 'batman123', 'bbbbbbbb', 'beautiful',
  'blink182', 'butterfly', 'cccccccc', 'changeme', 'changeme1', 'charlie1', 'chelsea1', 'chen1234',
  'chen123456', 'chocolate', 'computer', 'cookie12', 'dddddddd', 'december', 'default1', 'doggie12',
  'doraemon', 'dragon12', 'dragon123', 'eeeeeeee', 'facebook', 'family12', 'fangtang', 'fangtang1',
  'fangtang123', 'ffffffff', 'flower12', 'football', 'football1', 'forever1', 'fortnite', 'freedom1',
  'friends1', 'gggggggg', 'google123', 'guest123', 'handsome', 'hello123', 'hello1234', 'hellokitty',
  'helloworld', 'hhhhhhhh', 'iiiiiiii', 'iloveu123', 'iloveyou', 'iloveyou1', 'iloveyou12', 'iloveyou123',
  'iloveyou2', 'iloveyou520', 'internet', 'ironman1', 'january1', 'jennifer', 'jessica1', 'jjjjjjjj',
  'jordan23', 'kitten12', 'kitty123', 'kkkkkkkk', 'letmein00', 'letmein1', 'letmein12', 'letmein123',
  'li123456', 'liu123456', 'liverpool', 'llllllll', 'login123', 'lovelove', 'lovely12', 'loveme12',
  'loveme123', 'loveyou1', 'manchester', 'master12', 'master123', 'matrix123', 'metallica', 'michael1',
  'michelle', 'minecraft', 'mmmmmmmm', 'monkey12', 'monkey123', 'mustang1', 'mypass123', 'mypassword',
  'naruto12', 'naruto123', 'nintendo', 'nnnnnnnn', 'november', 'october1', 'onepiece', 'oooooooo',
  'p4ssw0rd', 'pa55w0rd', 'pa55word', 'passw0rd', 'passwd123', 'password', 'password01', 'password1',
  'password11', 'password12', 'password123', 'password1234', 'password12345', 'password2', 'password7',
  'password99', 'passwords', 'pikachu1', 'playslides', 'playstation', 'pokemon1', 'pokemon123', 'pppppppp',
  'princess', 'princess1', 'puppy123', 'q1w2e3r4', 'q1w2e3r4t5', 'q1w2e3r4t5y6', 'qazwsx123', 'qazwsxedc',
  'qq123456', 'qq1234567', 'qq12345678', 'qqqqqqqq', 'qwe12345', 'qwe123456', 'qweasd123', 'qweasdzxc',
  'qwer1234', 'qwerty11', 'qwerty12', 'qwerty123', 'qwerty1234', 'qwerty12345', 'qwerty123456', 'qwertyu1',
  'qwertyui', 'qwertyuio', 'qwertyuiop', 'rainbow1', 'realmadrid', 'root1234', 'rrrrrrrr', 'samsung1',
  'samsung123', 'secret12', 'secret123', 'september', 'shadow12', 'shadow123', 'slides123', 'slides1234',
  'slides2026', 'slidesgame', 'slipknot', 'snoopy12', 'spiderman', 'spring12', 'ssssssss', 'starwars',
  'starwars1', 'summer12', 'sunflower', 'sunshine', 'sunshine1', 'superman', 'superman1', 'sweetie1',
  'test1234', 'test12345', 'testtest', 'tigger12', 'together', 'trustno1', 'tttttttt', 'user1234',
  'uuuuuuuu', 'vvvvvvvv', 'w123456789', 'wang1234', 'wang123456', 'welcome1', 'welcome12', 'welcome123',
  'whatever', 'whatever1', 'winter12', 'woaini12', 'woaini123', 'woaini1234', 'woaini1314', 'woaini520',
  'woaiwojia', 'woshishui', 'ww123456', 'wwwwwwww', 'xx123456', 'xxxxxxxx', 'yyyyyyyy', 'z123456789',
  'zaq12wsx', 'zaq1zaq1', 'zhang123', 'zhang123456', 'zxc12345', 'zxc123456', 'zxcvbnm1', 'zxcvbnm123',
  'zxcvbnma', 'zxcvbnmasd', 'zz123456', 'zzzzzzzz', '00000000', '000000000', '0000000000', '01234567',
  '0123456789', '10203040', '11111111', '111111111', '1111111111', '11111112', '11112222', '11223344',
  '1122334455', '112233445566', '12121212', '1212121212', '12312312', '123123123', '1231231234', '123321123',
  '12341234', '12344321', '1234512345', '12345612', '123456123', '12345678', '123456789', '1234567890',
  '12345678910', '123456789123', '1234567899', '123456789a', '12345678a', '12345679', '1234567a', '1234567q',
  '123456aa', '123456ab', '123456abc', '123456qq', '123456qwe', '12345qwert', '12345qwerty', '12348765',
  '1234abcd', '1234qwer', '123654789', '123qweasd', '123qweasdzxc', '12qwaszx', '1314131413', '13145200',
  '1314520520', '13579246', '135792468', '1357924680', '147258369', '147852369', '147896325', '159357852',
  '19491001', '19881988', '19901990', '1q2w3e4r', '1q2w3e4r5t', '1q2w3e4r5t6y', '1qaz2wsx', '1qaz2wsx3edc',
  '1qazxsw2', '20002000', '20102010', '20202020', '20242024', '20252025', '20262026', '22222222',
  '222222222', '2222222222', '23456789', '246813579', '24682468', '2wsx3edc', '321654987', '33333333',
  '333333333', '3333333333', '34567890', '3edc4rfv', '44444444', '444444444', '4444444444', '456789123',
  '52005200', '52013145', '5201314520', '5201314a', '55555555', '555555555', '5555555555', '66666666',
  '666666666', '6666666666', '741852963', '77777777', '777777777', '7777777777', '789456123', '87654321',
  '88888888', '888888888', '8888888888', '963852741', '98765432', '987654321', '9876543210', '99999999',
  '999999999', '9999999999',
]);

/** 这一串是不是太常见了（大小写不敏感）。 */
export const isCommonFirst = (first) => COMMON.has(String(first ?? '').toLowerCase());

/** 表里有几条——门拿它当尺子（「几百条」，不是空表）。 */
export const COMMON_FIRST_COUNT = COMMON.size;

const { Client, MessageMedia, LocalAuth, List } = require('whatsapp-web.js');
const express = require('express');
const { body, validationResult } = require('express-validator');
const socketIO = require('socket.io');
const http = require('http');
const fs = require('fs');
const { phoneNumberFormatter } = require('./helpers/formatter.js');
const fileUpload = require('express-fileupload');
const axios = require('axios');
const bodyParser = require('body-parser');
const rimraf = require('rimraf');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');


//Funções
const { regexHorarioAtual } = require('./src/regex/horario.js');
const regex = regexHorarioAtual();


dotenv.config();

const port = process.env.PORT || 4040;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

app.use(fileUpload({
  debug: false
}));

app.get('/', (req, res) => {
  res.sendFile('index.html', {
    root: __dirname
  });
});

let generatedQrLink = '';
let conectado = false;
const generateSession = async (unique_id) => {
  const client = new Client({
    restartOnAuthFail: true,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ],
    },
    authStrategy: new LocalAuth({ clientId: unique_id }),
  });

  client.initialize();

  client.on('qr', async (qr) => {
    const generatedQrLink = qr;
    await enviarQrCodeParaBanco(generatedQrLink, unique_id);
  });

  client.initialize();

  let generatedQrLink = '';

  client.on('qr', (qr) => {
    generatedQrLink = qr;
    unique_id = unique_id;
    enviarQrCode(generatedQrLink, unique_id);
  });

  client.on('ready', () => {
    console.log(`Cliente está pronto para uso.`);
});



//Cliente autenticado
client.on('authenticated', async () => {
  console.log(`Autenticado para unique_id: ${unique_id}`);
  try {
    // Obter uma conexão do pool
    const connection = await pool.getConnection();

    // Atualizar o campo 'conectado' no banco de dados para true
    await connection.execute('UPDATE sessoes SET conectado = ? WHERE unique_id = ?', [true, unique_id]);

    // Liberar a conexão de volta ao pool
    connection.release();

    console.log(`Conectado e sessão atualizada para conectado: true`);
  } catch (error) {
    console.error('Erro ao fazer a atualização no banco de dados:', error.message);
  }
});



//Falha na autenticação
client.on('auth_failure', () => {
    console.log(`Falha na autenticação para unique_id: ${unique_id}, reiniciando...`);
    client.destroy();
    client.initialize();
  });



//Cliente desconectado
client.on('disconnected', async (reason) => {
      console.log(`O cliente para unique_id: ${unique_id} está desconectado! Motivo: ${reason}`);
  
      let response;
  
      try {
        console.log('Enviando solicitação PATCH...');
        // Fazer uma solicitação PATCH apenas se o cliente estiver conectado
        response = await axios.patch(`https://x8ki-letl-twmt.n7.xano.io/api:vUQ0wx1e/sessoes/{sessoes_id}`, {
          unique_id: unique_id,
          conectado: false,
        });
        console.log('Solicitação PATCH enviada com sucesso!', response.data); // Log da resposta da API
        client.destroy();

          // Excluir a pasta da sessão
        const pastaSessaoPath = `.wwebjs_auth/session-${unique_id}`;
        rimraf.sync(pastaSessaoPath);
        console.log('Pasta da sessão excluída com sucesso:', pastaSessaoPath);

        // Após a solicitação PATCH, faça uma nova solicitação POST para criar ou atualizar a sessão
        const generateSessionResponse = await axios.post('http://localhost:4040/generate-session', {
          unique_id: unique_id,
        });

        console.log('Resposta da geração de sessão:', generateSessionResponse.data);
      } catch (error) {
        console.error('Erro ao enviar solicitação PATCH:', error);
      } finally {
          client.destroy();
          // Pode ser necessário tratar a reconexão aqui se desejado
      }
  
      return response;
  });
};  



//Buscar e atualizar QR Code no banco
const buscarQrCodeNoBanco = async (unique_id) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.execute('SELECT qr_code FROM sessoes WHERE unique_id = ?', [unique_id]);
    connection.release();
    if (rows.length > 0) {
      return rows[0].qr_code;
    } else {
      return null;
    }
  } catch (error) {
    console.error('Erro ao buscar código QR no banco de dados:', error);
    return null;
  }
};



//Criar ou atualizar o QR Code no banco
const enviarQrCodeParaBanco = async (qrLink, unique_id) => {
  try {
    const qrCodeExistente = await buscarQrCodeNoBanco(unique_id);
    if (qrCodeExistente) {
      const connection = await pool.getConnection();
      await connection.execute('UPDATE sessoes SET qr_code = ? WHERE unique_id = ?', [qrLink, unique_id]);
      connection.release();
      console.log('Código QR atualizado no banco de dados com sucesso.');
    } else {
      const connection = await pool.getConnection();
      await connection.execute('INSERT INTO sessoes (unique_id, qr_code) VALUES (?, ?)', [unique_id, qrLink ]);
      connection.release();
      console.log('Código QR inserido no banco de dados com sucesso.', regex);
    }
  } catch (error) {
    console.error('Erro ao enviar código QR para o banco de dados:', error);
  }
};



//Criar uma sessao
app.post('/generate-session', async (req, res) => {
  try {
    const { unique_id } = req.body;
    await generateSession(unique_id);
    res.status(200).json({ message: 'Sessão em processo de criação.' });
    console.log('Verificando a sessão:', unique_id, '! Se não existir, será criada uma nova; caso exista, será atualizada.');
  } catch (error) {
    console.error('Erro ao gerar sessão:', error);
    res.status(500).json({ error: 'Erro ao gerar sessão' });
  }
});



//Deletar sessao
app.post('/delete-session', async (req, res) => {
  try {
    const { unique_id } = req.body;

    // Excluir a pasta da sessão
    const pastaSessaoPath = `.wwebjs_auth/session-${unique_id}`;
    rimraf.sync(pastaSessaoPath);
    console.log('Pasta da sessão excluída com sucesso:', pastaSessaoPath);

    // Fazer uma solicitação PATCH para marcar a sessão como desconectada
    const response = await axios.patch(`https://x8ki-letl-twmt.n7.xano.io/api:vUQ0wx1e/sessoes/{sessoes_id}`, {
      unique_id: unique_id,
      conectado: false,
    });

    console.log('Solicitação PATCH enviada com sucesso!', response.data); // Log da resposta da API

    // Após a solicitação PATCH, faça uma nova solicitação POST para criar ou atualizar a sessão
    const generateSessionResponse = await axios.post('http://localhost:4040/generate-session', {
      unique_id: unique_id,
    });

    console.log('Resposta da geração de sessão:', generateSessionResponse.data);

    res.status(200).json({ message: 'Sessão excluída e em processo de criação.' });
  } catch (error) {
    console.error('Erro ao deletar sessão:', error);
    res.status(500).json({ error: 'Erro ao deletar sessão' });
  }
});


app.post('/bloquear-pagamento-session', async (req, res) => {
  try {
    const { unique_id } = req.body;

    // Excluir a pasta da sessão
    const pastaSessaoPath = `.wwebjs_auth/session-${unique_id}`;
    rimraf.sync(pastaSessaoPath);
    console.log('Pasta da sessão excluída com sucesso:', pastaSessaoPath);

    // Fazer uma solicitação PATCH para marcar a sessão como desconectada
    const response = await axios.patch(`https://x8ki-letl-twmt.n7.xano.io/api:vUQ0wx1e/sessoes/{sessoes_id}`, {
      unique_id: unique_id,
      conectado: false,
      bloqueado_pagamento: true,
    });

    console.log('Solicitação PATCH enviada!', unique_id, 'bloqueado com sucesso ✅🛒', response.data); // Log da resposta da API

    res.status(200).json({ message: 'Sessão excluída' });
  } catch (error) {
    console.error('Erro ao deletar sessão:', error);
    res.status(500).json({ error: 'Erro ao deletar sessão' });
  }
});


const checkRegisteredNumber = async function(number) {
  const isRegistered = await client.isRegisteredUser(number);
  return isRegistered;
}

// Use o middleware bodyParser.urlencoded para interpretar form-data
app.use(bodyParser.urlencoded({ extended: true }));

app.post('/send-messages', [
  body('numbers').notEmpty(), // Ajuste conforme necessário
  body('message').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({ msg }) => msg);

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  // Parse da string de números separados por vírgula
  const numbers = req.body.numbers.split(',').map(phoneNumberFormatter);
  console.log('Numbers:', numbers);
  const message = req.body.message;

  const promises = numbers.map(async (number) => {
    const formattedNumber = number.toString(); // Converte para string

    const isRegisteredNumber = await checkRegisteredNumber(formattedNumber);

    if (!isRegisteredNumber) {
      return {
        number: formattedNumber,
        status: false,
        message: 'The number is not registered'
      };
    }

    return client.sendMessage(String(formattedNumber), message) // Converta para string aqui também
      .then(response => ({
        number: formattedNumber,
        status: true,
        response
      }))
      .catch(err => ({
        number: formattedNumber,
        status: false,
        response: err
      }));
  });

  const results = await Promise.all(promises);
  res.status(200).json(results);
});

// Send media
app.post('/send-media', async (req, res) => {
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;
  const fileUrl = req.body.file;

  // const media = MessageMedia.fromFilePath('./image-example.png');
  // const file = req.files.file;
  // const media = new MessageMedia(file.mimetype, file.data.toString('base64'), file.name);
  let mimetype;
  const attachment = await axios.get(fileUrl, {
    responseType: 'arraybuffer'
  }).then(response => {
    mimetype = response.headers['content-type'];
    return response.data.toString('base64');
  });

  const media = new MessageMedia(mimetype, attachment, 'Media');

  client.sendMessage(number, media, {
    caption: caption
  }).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

const findGroupByName = async function(name) {
  const group = await client.getChats().then(chats => {
    return chats.find(chat => 
      chat.isGroup && chat.name.toLowerCase() == name.toLowerCase()
    );
  });
  return group;
}

// Send message to group
// You can use chatID or group name, yea!
app.post('/send-group-message', [
  body('id').custom((value, { req }) => {
    if (!value && !req.body.name) {
      throw new Error('Invalid value, you can use `id` or `name`');
    }
    return true;
  }),
  body('message').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  let chatId = req.body.id;
  const groupName = req.body.name;
  const message = req.body.message;

  // Find the group by name
  if (!chatId) {
    const group = await findGroupByName(groupName);
    if (!group) {
      return res.status(422).json({
        status: false,
        message: 'No group found with name: ' + groupName
      });
    }
    chatId = group.id._serialized;
  }

  client.sendMessage(chatId, message).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

// Clearing message on spesific chat
app.post('/clear-message', [
  body('number').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  const number = phoneNumberFormatter(req.body.number);

  const isRegisteredNumber = await checkRegisteredNumber(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: 'The number is not registered'
    });
  }

  const chat = await client.getChatById(number);
  
  chat.clearMessages().then(status => {
    res.status(200).json({
      status: true,
      response: status
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  })
});


// Buscar QR Code
app.get('/qr-link', (req, res) => {
  if (conectado) {
    console.log('Conteúdo de generatedQrLink:', generatedQrLink);
    res.send(`${generatedQrLink}`);
  } else {
    res.send ('Dispositivo conectado... ✅')
  }

});
server.listen(port, function() {
  console.log('App running on *: ' + port);
});
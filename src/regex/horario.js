function regexHorarioAtual() {
    // Obter o horário atual
    const now = new Date();
  
    // Formatar o horário atual como "HH:MM:SS"
    const formattedTime = `${padZero(now.getHours())}:${padZero(now.getMinutes())}:${padZero(now.getSeconds())}`;
  
    // Função para adicionar um zero à esquerda para números menores que 10
    function padZero(num) {
      return num < 10 ? `0${num}` : num;
    }
  
    // Criar e retornar a expressão regular para o horário atual
    return new RegExp(`${formattedTime}`);
  }

  module.exports = { regexHorarioAtual };

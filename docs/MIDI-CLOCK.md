# MIDI Clock (DK-111/DK-112, Song Position D-17)

O DoubleK pode seguir o andamento de um CDJ, de um mixer ou do Traktor/Rekordbox pelo **MIDI Clock**, em vez de deduzi-lo dos kicks do áudio. Nada precisa ser ligado no app: o clock é lido nas mesmas portas MIDI que já são abertas para os controladores.

## Como funciona

| Situação | Quem manda no relógio do beat | `Frame.clock` |
|---|---|---|
| Nenhum pulso de clock chegando | o áudio (detecção de kick, como sempre) | `"audio"` |
| Pulsos chegando (0xF8, 24 por beat), sem Start | **andamento** do MIDI; **fase** do áudio (os kicks alinham a grade) | `"midi"` |
| Depois de um Start (0xFA) | andamento **e fase** do MIDI: o 1º pulso depois do Start é o beat 0 | `"midi"` |
| Depois de um Continue (0xFB) com Song Position (0xF2) antes | andamento **e fase** do MIDI: o 1º pulso depois do Continue é a posição do SPP | `"midi"` |
| 2 s sem pulso | volta para o áudio, que reaproveita o andamento e re-trava pelos kicks | `"audio"` |

- **Andamento:** regressão instante × índice dos últimos 96 pulsos (4 beats). Pulsos perdidos contam pelo intervalo, e pulsos fora do lugar (duplicados, jitter grosso) são descartados. Numa troca de andamento, se o último beat de pulsos foge mais de 3 % da regressão, a janela recomeça nele.
- **Stop (0xFC)** não muda o relógio; **Continue (0xFB)** sem Song Position também não. Quem para de mandar pulsos devolve o relógio ao áudio.
- A detecção de kick continua rodando: os flashes, o espectro e o "tem grave" vêm do áudio.
- A reprodução de faixa pelo roteiro (o app tocando o arquivo) usa a grade da própria faixa (ou o mapa de andamento, se o BPM dela muda) e ignora o clock.

## Song Position Pointer (D-17)

O **Song Position Pointer** (0xF2) diz em que ponto da música o equipamento está, em "MIDI beats" = **semicolcheias** (6 pulsos de clock), de 0 a 16383. Dois bytes de 7 bits, o menos significativo primeiro.

| Quando chega | O que o DoubleK faz |
|---|---|
| Transporte **parado** (depois de um Stop) | guarda a posição; nada muda até o **Continue** |
| **Continue** com posição guardada | o 1º pulso depois dele vale a posição: beat = SPP ÷ 4, fase = (SPP mod 4) ÷ 4 |
| Transporte **andando** (equipamento que pula durante o play) | o próximo pulso já vale a posição nova |
| **Start** depois de uma posição guardada | o Start ganha: zera no beat 0, como sempre |
| SPP malformado (byte de dado ≥ 0x80, mensagem cortada) | ignorado |

- O andamento não se perde: em vez de recomeçar a janela de pulsos, o app desloca a contagem dos pulsos que já tem. Se o clock continuou pulsando durante o Stop (o comum), beat e fase valem **já no 1º pulso** depois do Continue. Se o clock também parou por mais de 2 s, o relógio volta ao áudio e, no Continue, a fase do SPP passa a valer quando houver 1 beat de pulsos (como depois de um Start).
- "Parado" ou "andando" vem do Start/Continue/Stop. **Dívida:** se o equipamento nunca mandou nenhum deles desde que o DoubleK abriu, o app considera "andando" quando há pulsos chegando, e o SPP vale no próximo pulso.
- Exemplo: Stop, SPP 37, Continue → 37 semicolcheias = beat 9 e mais 1 semicolcheia → o 1º pulso cai no 2º tempo do 3º compasso (beat 9, contando do 0), fase 0,25.

### Roteiro para testar com equipamento (mantenedor)

**NÃO VERIFICADO** até alguém rodar isto. Primeiro, confira se o software ou equipamento manda Song Position. Muitos softwares de DJ mandam só pulso + Start/Stop, e aí o Continue continua sem posição (comportamento de antes).

1. **Porta virtual:** instale o loopMIDI e crie uma porta (ex.: "DoubleK Clock"). Abra o DoubleK depois: a porta aparece na lista MIDI.
2. **Fonte com SPP:** um DAW com saída de MIDI Clock **e** Song Position para a porta do loopMIDI (no Reaper, a saída MIDI tem a opção de mandar clock/SPP — confira o nome no seu). Traktor e Rekordbox: ative o envio de MIDI Clock para a mesma porta e veja se o Continue reposiciona (se não, o software não manda SPP).
3. Com o DoubleK ouvindo, dê **Play** desde o início: o selo mostra **MIDI CLK** e a bolinha 1 acende no 1º tempo de cada compasso.
4. **Stop**, mova o cursor para o **2º tempo** de algum compasso e dê **Continue/Play**: a bolinha acesa logo depois tem de ser a **2** (antes do D-17, a fase ficava a do áudio).
5. Durante o play, **pule** para outro compasso, se o software deixar: a bolinha acompanha no pulso seguinte.
6. **Stop** e **Start** do começo: volta para a bolinha 1.
7. Anote software, versão e o que aconteceu em cada passo. O atraso fixo se calibra no **offset** visual, como sempre.

## Como ligar

1. No software ou equipamento do DJ, ative o envio de MIDI Clock (no Traktor: *Preferences → MIDI Clock → Send MIDI Clock*; Rekordbox/CDJ: depende do modelo).
2. Ligue a saída MIDI dele ao computador do telão (cabo USB-MIDI, interface ou porta virtual como loopMIDI).
3. Abra o DoubleK. A porta aparece na lista de controladores MIDI. "(ocupado)" significa que outro programa abriu a porta antes, porque no Windows a entrada MIDI costuma ser exclusiva.
4. O selo de BPM mostra **MIDI CLK** enquanto o clock manda. Para alinhar a fase pelo clock, dê **Start** no equipamento depois que o DoubleK já estiver ouvindo.

O atraso entre o pulso e o quadro é o mesmo do resto do telão. Calibre pelo **offset** visual.

## Limitações

- **NÃO VERIFICADO com hardware:** CDJ, Traktor, Rekordbox, interfaces USB-MIDI e loopMIDI. Os testes usam pulsos sintéticos.
- Song Position só ajuda se o equipamento mandar SPP antes do Continue (ou ao pular). Sem ele, o Continue recupera só o andamento.
- Sem Ableton Link (fica para depois, se houver demanda).
- A fase vinda do Start supõe que o equipamento manda o 1º pulso no beat 1, como diz a especificação MIDI.

## Testes

```powershell
cd src-tauri
cargo test --release midi_clock     # pulsos com jitter ±2 ms, 10 % perdidos, duplicado, Start/Stop, 140 → 175 BPM, solta em 2 s
cargo test --release relogio_midi   # Analyzer: andamento e fase do MIDI no Frame, e volta para o áudio
cargo test --release spp            # Song Position: Stop → SPP 37 → Continue (beat 9, fase 0,25 no 1º pulso), SPP sem Continue ignorado,
                                    # SPP durante o play, silêncio > 2 s, limites 0 e 16383, malformado, Start ganha do SPP guardado
```

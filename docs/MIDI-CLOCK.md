# MIDI Clock (DK-111/DK-112)

O DoubleK pode seguir o andamento de um CDJ, de um mixer ou do Traktor/Rekordbox pelo **MIDI Clock**, em vez de deduzi-lo dos kicks do áudio. Nada precisa ser ligado no app: o clock é lido nas mesmas portas MIDI que já são abertas para os controladores.

## Como funciona

| Situação | Quem manda no relógio do beat | `Frame.clock` |
|---|---|---|
| Nenhum pulso de clock chegando | o áudio (detecção de kick, como sempre) | `"audio"` |
| Pulsos chegando (0xF8, 24 por beat), sem Start | **andamento** do MIDI; **fase** do áudio (os kicks alinham a grade) | `"midi"` |
| Depois de um Start (0xFA) | andamento **e fase** do MIDI: o 1º pulso depois do Start é o beat 0 | `"midi"` |
| 2 s sem pulso | volta para o áudio, que reaproveita o andamento e re-trava pelos kicks | `"audio"` |

- **Andamento:** regressão instante × índice dos últimos 96 pulsos (4 beats). Pulsos perdidos contam pelo intervalo, e pulsos fora do lugar (duplicados, jitter grosso) são descartados. Numa troca de andamento, se o último beat de pulsos foge mais de 3 % da regressão, a janela recomeça nele.
- **Continue (0xFB) e Stop (0xFC)** não mudam nada. Sem Song Position Pointer não se sabe onde a música está; quem para de mandar pulsos devolve o relógio ao áudio.
- A detecção de kick continua rodando: os flashes, o espectro e o "tem grave" vêm do áudio.
- A reprodução de faixa pelo roteiro (o app tocando o arquivo) usa a grade da própria faixa e ignora o clock.

## Como ligar

1. No software ou equipamento do DJ, ative o envio de MIDI Clock (no Traktor: *Preferences → MIDI Clock → Send MIDI Clock*; Rekordbox/CDJ: depende do modelo).
2. Ligue a saída MIDI dele ao computador do telão (cabo USB-MIDI, interface ou porta virtual como loopMIDI).
3. Abra o DoubleK. A porta aparece na lista de controladores MIDI. "(ocupado)" significa que outro programa abriu a porta antes, porque no Windows a entrada MIDI costuma ser exclusiva.
4. O selo de BPM mostra **MIDI CLK** enquanto o clock manda. Para alinhar a fase pelo clock, dê **Start** no equipamento depois que o DoubleK já estiver ouvindo.

O atraso entre o pulso e o quadro é o mesmo do resto do telão. Calibre pelo **offset** visual.

## Limitações

- **NÃO VERIFICADO com hardware:** CDJ, Traktor, Rekordbox, interfaces USB-MIDI e loopMIDI. Os testes usam pulsos sintéticos.
- Sem Song Position: Continue não recupera a posição no compasso, só o andamento.
- Sem Ableton Link (fica para depois, se houver demanda).
- A fase vinda do Start supõe que o equipamento manda o 1º pulso no beat 1, como diz a especificação MIDI.

## Testes

```powershell
cd src-tauri
cargo test --release midi_clock     # pulsos com jitter ±2 ms, 10 % perdidos, duplicado, Start/Stop, 140 → 175 BPM, solta em 2 s
cargo test --release relogio_midi   # Analyzer: andamento e fase do MIDI no Frame, e volta para o áudio
```

import Vue from 'vue';
declare module 'vue' {
  export default interface Vue {
    $pbem: any;
    $pbemServer: any;
  }
}

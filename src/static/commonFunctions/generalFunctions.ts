import {Dimensions} from "react-native";
import {TAB_WIDTH} from "../constents.ts";

export const getIsTablet=()=>Dimensions.get('window').width > TAB_WIDTH;
